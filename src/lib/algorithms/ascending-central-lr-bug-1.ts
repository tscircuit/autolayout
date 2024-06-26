import { Box, Connection, Port } from "../types"
import { getConnectionMap } from "./sub-algorithms/getConnectionMap"
import { centerSides } from "./sub-algorithms/centerSides"
import { findBoxWithMostPorts } from "./sub-algorithms/findBoxWithMostPorts"
import { slideBoxesConnectedToSameNet } from "./sub-algorithms/slideBoxesConnectedToSameNet"
import { LayoutAlgorithm } from "./type"
import { removeAscendingBoxIndexGaps } from "./sub-algorithms/removeAscendingBoxIndexGaps"
import { addBoxesForNetsRewriteNetsToPlacedAliases as addBoxesForNetsRewriteNetsToPlacedAliases } from "./sub-algorithms/addBoxesForNetsRewriteNetsToSpecificAliases"
import { autoRotateTwoPortBoxes } from "./auto-rotate-two-port-boxes"

export type BoxWithAscendingIndex = Box & {
  side: "left" | "right"
  /**
   * How high from the bottom w.r.t. port connections
   */
  ascending_port_index: number
  /**
   * How high from the bottom this box should be ordered
   */
  ascending_box_index: number

  width: number
}

export const ascendingCentralLrBug1: LayoutAlgorithm = (scene) => {
  const netSet = new Set(scene.nets.map((n) => n.net_id))
  // Map port_id to whatever port it connects to
  const connMap = getConnectionMap(scene)

  const new_boxes: BoxWithAscendingIndex[] = JSON.parse(
    JSON.stringify(scene.boxes)
  )
  const new_conns: Connection[] = JSON.parse(JSON.stringify(scene.connections))

  // TODO remove reset in prod
  for (const box of new_boxes) {
    box.x = 0
    box.y = 0
    let smallest_port_rx = 0,
      largest_port_rx = 0
    for (const port of box.ports) {
      if (port.rx < smallest_port_rx) {
        smallest_port_rx = port.rx
      } else if (port.rx > largest_port_rx) {
        largest_port_rx = port.rx
      }
    }
    box.width = largest_port_rx - smallest_port_rx
  }

  // 1. Identify central box
  const center_box: Omit<Box, "ports"> & {
    ports: Array<
      Port & { side: "left" | "right"; ascending_port_index: number }
    >
    width: number
  } = findBoxWithMostPorts(new_boxes) as any

  for (const port of center_box.ports) {
    if (port.rx > 0) {
      port.side = "right"
    } else if (port.rx < 0) {
      port.side = "left"
    }
  }

  // 2. Find the side each box is on
  for (const box of new_boxes) {
    if (box.box_id === center_box.box_id) continue

    const ports_box_is_connected_to = center_box.ports.filter((p) =>
      new_conns.some(
        (c) =>
          (c.from.startsWith(box.box_id) && c.to === p.port_id) ||
          (c.to.startsWith(box.box_id) && c.from === p.port_id)
      )
    )

    if (ports_box_is_connected_to.length === 0) {
      box.side = "left"
      continue
    }

    // If the box shares ports majority on the left side, then box.side = "left"
    // else it's on right
    let left_count = 0
    let right_count = 0

    for (const port of ports_box_is_connected_to) {
      if (port.rx > 0) {
        right_count += 1
      } else if (port.rx < 0) {
        left_count += 1
      }
    }

    if (left_count >= right_count) {
      box.side = "left"
    } else {
      box.side = "right"
    }
  }

  // 2. Get the ascending indices of the boxes
  // for (const box of new_boxes) {
  //   // TODO only use ports on same side as box
  //   const relevant_side_ports = box.ports
  // }

  for (const side of ["left", "right"]) {
    const side_ports = center_box.ports.filter((p) => p.side === side)
    side_ports.sort((a, b) => a.ry - b.ry)
    for (const port of side_ports) {
      port.ascending_port_index = side_ports.indexOf(port)
    }
  }

  for (const box of new_boxes) {
    if (box.box_id === center_box.box_id) continue
    const box_connections = scene.connections
      .filter(
        (connection) =>
          connection.from.startsWith(box.box_id + ".") ||
          connection.to.startsWith(box.box_id + ".")
      )
      .map((connection) =>
        connection.from.startsWith(box.box_id + ".")
          ? connection.to
          : connection.from
      )
    const ports_box_is_connected_to = center_box.ports.filter((p) =>
      box_connections.includes(p.port_id)
    )

    if (ports_box_is_connected_to.length === 0) {
      continue
    }

    box.ascending_port_index = Math.min(
      ...ports_box_is_connected_to.map((p: any) => p.ascending_port_index)
    )
    box.ascending_box_index = box.ascending_port_index
  }

  let highest_ascending_box_index = Math.max(
    0,
    ...new_boxes.map((b) => b.ascending_box_index).filter((bi) => !isNaN(bi))
  )

  for (const box of new_boxes) {
    if (box.box_id === center_box.box_id) continue
    if (box.ascending_box_index === undefined) {
      highest_ascending_box_index += 1
      box.ascending_box_index = highest_ascending_box_index
    }
  }

  // Remove box_index "gaps", e.g. if no boxes have index 1, then every index >1
  // should be decremented by 1
  // TODO: this is an N^2 algorithm, easily can be made N
  for (const side of ["left", "right"]) {
    removeAscendingBoxIndexGaps(
      highest_ascending_box_index,
      new_boxes.filter((b) => b.side === side)
    )
  }

  for (const side of ["left", "right"]) {
    let travel_x = center_box.width * 0.75 * (side === "left" ? -1 : 1)
    for (let i = 0; i <= highest_ascending_box_index; i++) {
      const boxes_on_same_index = new_boxes.filter(
        (b) => b.side === side && b.ascending_box_index === i
      )
      const widest_box_width = Math.max(
        ...boxes_on_same_index.map((b) => b.width)
      )
      const dist_to_last_col =
        Math.max(0.5, widest_box_width) * (side === "left" ? -1 : 1)
      travel_x += dist_to_last_col
      for (const box of boxes_on_same_index) {
        if (box.box_id === center_box.box_id) continue
        box.y = box.ascending_box_index * 1.25
        box.x = travel_x
      }
      travel_x += dist_to_last_col / 2
    }
  }

  slideBoxesConnectedToSameNet(new_boxes, connMap, netSet, scene)

  // Add boxes representing the net, anything with the same ascending_box_index
  // can share the same net box
  addBoxesForNetsRewriteNetsToPlacedAliases(new_boxes, scene, netSet, new_conns)

  centerSides(new_boxes, center_box)

  const new_scene = {
    ...scene,
    connections: new_conns,
    boxes: new_boxes,
  }

  autoRotateTwoPortBoxes(new_scene)

  return new_scene
  // return alignTbBoxesWithNetConnection(new_scene)
}
