export function createWorker(self) {
  let matrices = undefined
  // multiply: matrix4x4 * vector3
  const mul = function mul(e, x, y, z) {
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15])
    return [
      (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
      (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
      (e[2] * x + e[6] * y + e[10] * z + e[14]) * w
    ]
  }

  // dot: vector3 * vector3
  const dot = function dot(vec1, vec2) {
    return vec1[0] * vec2[0] + vec1[1] * vec2[1] + vec1[2] * vec2[2]
  }

  const sortSplats = function sortSplats(matrices, view, cutout = undefined) {
    const vertexCount = matrices.length / 16
    let threshold = -0.0001
    let maxDepth = -Infinity
    let minDepth = Infinity
    let depthList = new Float32Array(vertexCount)
    let sizeList = new Int32Array(depthList.buffer)
    let validIndexList = new Int32Array(vertexCount)
    let validCount = 0
    for (let i = 0; i < vertexCount; i++) {
      // Sign of depth is reversed
      let depth = view[0] * matrices[i * 16 + 12] + view[1] * matrices[i * 16 + 13] + view[2] * matrices[i * 16 + 14] + view[3]
      let cutoutArea = true
      if (cutout !== undefined) {
        // Position-based culling
        let posX = matrices[i * 16 + 12]
        let posY = matrices[i * 16 + 13]
        let posZ = matrices[i * 16 + 14]
        // convert to cutout space – not sure why Y axis is inverted
        const cutoutSpacePos = mul(cutout, posX, -posY, posZ)
        const len = dot(cutoutSpacePos, cutoutSpacePos)
        // box cutout
        if (
          cutoutSpacePos[0] < -0.5 ||
          cutoutSpacePos[0] > 0.5 ||
          cutoutSpacePos[1] < -0.5 ||
          cutoutSpacePos[1] > 0.5 ||
          cutoutSpacePos[2] < -0.5 ||
          cutoutSpacePos[2] > 0.5
        )
          cutoutArea = false
        // spherical cutout
        // if (dot(cutoutSpacePos, cutoutSpacePos) > 1)
        // 	cutoutArea = false;
      }

      // Skip behind of camera and small, transparent splat
      if (depth < 0 && matrices[i * 16 + 15] > threshold * depth && cutoutArea) {
        depthList[validCount] = depth
        validIndexList[validCount] = i
        validCount++
        if (depth > maxDepth) maxDepth = depth
        if (depth < minDepth) minDepth = depth
      }
    }

    // This is a 16 bit single-pass counting sort
    let depthInv = (256 * 256 - 1) / (maxDepth - minDepth)
    let counts0 = new Uint32Array(256 * 256)
    for (let i = 0; i < validCount; i++) {
      sizeList[i] = ((depthList[i] - minDepth) * depthInv) | 0
      counts0[sizeList[i]]++
    }
    let starts0 = new Uint32Array(256 * 256)
    for (let i = 1; i < 256 * 256; i++) starts0[i] = starts0[i - 1] + counts0[i - 1]
    let depthIndex = new Uint32Array(validCount)
    for (let i = 0; i < validCount; i++) depthIndex[starts0[sizeList[i]]++] = validIndexList[i]
    return depthIndex
  }

  self.onmessage = (e) => {
    if (e.data.method == 'clear') {
      matrices = undefined
    }
    if (e.data.method == 'push') {
      const new_matrices = new Float32Array(e.data.matrices)
      if (matrices === undefined) {
        matrices = new_matrices
      } else {
        resized = new Float32Array(matrices.length + new_matrices.length)
        resized.set(matrices)
        resized.set(new_matrices, matrices.length)
        matrices = resized
      }
    }
    if (e.data.method == 'sort') {
      if (matrices === undefined) {
        const sortedIndexes = new Uint32Array(1)
        self.postMessage({ sortedIndexes }, [sortedIndexes.buffer])
      } else {
        const view = new Float32Array(e.data.view)
        const sortedIndexes = sortSplats(matrices, view, undefined)
        self.postMessage({ sortedIndexes }, [sortedIndexes.buffer])
      }
    }
  }
}
