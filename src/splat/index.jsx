// Based on:
//   https://github.com/quadjr/aframe-gaussian-splatting
//   https://github.com/antimatter15/splat

import * as THREE from 'three'
import { useEffect, useMemo, useState, useRef, useLayoutEffect } from 'react'
import { extend, useThree, useFrame } from '@react-three/fiber'
import { SplatMaterial } from './SplatMaterial'
import { createWorker } from './worker'
import {forwardRef} from 'react'

export let Splat =  forwardRef(function Splat({ src, ...props },ref) {
  extend({ SplatMaterial })
  const worker = useMemo(
    () =>
      new Worker(
        URL.createObjectURL(
          new Blob(['(', createWorker.toString(), ')(self)'], {
            type: 'application/javascript'
          })
        )
      ),
    [src]
  )
  // const ref = useRef()
  const obj = useRef()
  const { gl, camera } = useThree()
  const [context] = useState(() => gl.getContext())
  const locals = useMemo(
    () => ({
      ready: false,
      loadedVertexCount: 0,
      rowLength: 3 * 4 + 3 * 4 + 4 + 4,
      maxVertexes: 0,
      bufferTextureWidth: 0,
      bufferTextureHeight: 0,
      centerAndScaleData: null,
      covAndColorData: null,
      centerAndScaleTexture: null
    }),
    [src]
  )

  useEffect(() => {
    worker.postMessage({ method: 'clear' })
    async function run() {
      const data = await fetch(src)
      const reader = data.body.getReader()

      let glInitialized = false
      let bytesDownloaded = 0
      let bytesProcesses = 0
      let _totalDownloadBytes = data.headers.get('Content-Length')
      let totalDownloadBytes = _totalDownloadBytes ? parseInt(_totalDownloadBytes) : undefined

      if (totalDownloadBytes != undefined) {
        let numVertexes = Math.floor(totalDownloadBytes / locals.rowLength)
        await initGL(numVertexes)
        glInitialized = true
      }

      const chunks = []
      const start = Date.now()
      let lastReportedProgress = 0
      let isPly = src.endsWith('.ply')

      while (true) {
        try {
          const { value, done } = await reader.read()
          if (done) {
            //console.log('Completed download.')
            break
          }
          bytesDownloaded += value.length
          if (totalDownloadBytes != undefined) {
            const mbps = bytesDownloaded / 1024 / 1024 / ((Date.now() - start) / 1000)
            const percent = (bytesDownloaded / totalDownloadBytes) * 100
            if (percent - lastReportedProgress > 1) {
              //console.log('download progress:', percent.toFixed(2) + '%', mbps.toFixed(2) + ' Mbps')
              lastReportedProgress = percent
            }
          } //else console.log('download progress:', bytesDownloaded, ', unknown total')
          chunks.push(value)

          const bytesRemains = bytesDownloaded - bytesProcesses
          if (!isPly && totalDownloadBytes != undefined && bytesRemains > locals.rowLength) {
            let vertexCount = Math.floor(bytesRemains / locals.rowLength)
            const concatenatedChunksbuffer = new Uint8Array(bytesRemains)
            let offset = 0
            for (const chunk of chunks) {
              concatenatedChunksbuffer.set(chunk, offset)
              offset += chunk.length
            }
            chunks.length = 0
            if (bytesRemains > vertexCount * locals.rowLength) {
              const extra_data = new Uint8Array(bytesRemains - vertexCount * locals.rowLength)
              extra_data.set(concatenatedChunksbuffer.subarray(bytesRemains - extra_data.length, bytesRemains), 0)
              chunks.push(extra_data)
            }
            const buffer = new Uint8Array(vertexCount * locals.rowLength)
            buffer.set(concatenatedChunksbuffer.subarray(0, buffer.byteLength), 0)
            pushDataBuffer(buffer.buffer, vertexCount)
            bytesProcesses += vertexCount * locals.rowLength
          }
        } catch (error) {
          console.error(error)
          break
        }
      }

      if (bytesDownloaded - bytesProcesses > 0) {
        // Concatenate the chunks into a single Uint8Array
        let concatenatedChunks = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0))
        let offset = 0
        for (const chunk of chunks) {
          concatenatedChunks.set(chunk, offset)
          offset += chunk.length
        }
        if (isPly) concatenatedChunks = new Uint8Array(processPlyBuffer(concatenatedChunks.buffer))
        let numVertexes = Math.floor(concatenatedChunks.byteLength / locals.rowLength)
        if (!glInitialized) {
          await initGL(numVertexes)
          glInitialized = true
        }
        pushDataBuffer(concatenatedChunks.buffer, numVertexes)
      }
    }

    async function initGL(numVertexes) {
      //console.log('initGL', numVertexes)

      let mexTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE)
      locals.maxVertexes = mexTextureSize * mexTextureSize

      if (numVertexes > locals.maxVertexes) {
        //console.log('numVertexes limited to ', locals.maxVertexes, numVertexes)
        numVertexes = locals.maxVertexes
      }
      locals.bufferTextureWidth = mexTextureSize
      locals.bufferTextureHeight = Math.floor((numVertexes - 1) / mexTextureSize) + 1

      locals.centerAndScaleData = new Float32Array(locals.bufferTextureWidth * locals.bufferTextureHeight * 4)
      locals.covAndColorData = new Uint32Array(locals.bufferTextureWidth * locals.bufferTextureHeight * 4)
      locals.centerAndScaleTexture = new THREE.DataTexture(
        locals.centerAndScaleData,
        locals.bufferTextureWidth,
        locals.bufferTextureHeight,
        THREE.RGBAFormat,
        THREE.FloatType
      )
      locals.centerAndScaleTexture.needsUpdate = true
      locals.covAndColorTexture = new THREE.DataTexture(
        locals.covAndColorData,
        locals.bufferTextureWidth,
        locals.bufferTextureHeight,
        THREE.RGBAIntegerFormat,
        THREE.UnsignedIntType
      )
      locals.covAndColorTexture.internalFormat = 'RGBA32UI'
      locals.covAndColorTexture.needsUpdate = true

      let splatIndexArray = new Uint32Array(locals.bufferTextureWidth * locals.bufferTextureHeight)
      const splatIndexes = new THREE.InstancedBufferAttribute(splatIndexArray, 1, false)
      splatIndexes.setUsage(THREE.DynamicDrawUsage)

      const baseGeometry = new THREE.InstancedBufferGeometry()
      const positionsArray = new Float32Array(6 * 3)
      const positions = new THREE.BufferAttribute(positionsArray, 3)
      baseGeometry.setAttribute('position', positions)
      positions.setXYZ(2, -2.0, 2.0, 0.0)
      positions.setXYZ(1, 2.0, 2.0, 0.0)
      positions.setXYZ(0, -2.0, -2.0, 0.0)
      positions.setXYZ(5, -2.0, -2.0, 0.0)
      positions.setXYZ(4, 2.0, 2.0, 0.0)
      positions.setXYZ(3, 2.0, -2.0, 0.0)
      positions.needsUpdate = true
      baseGeometry.setAttribute('splatIndex', splatIndexes)
      baseGeometry.instanceCount = 1

      ref.current.geometry = baseGeometry
      ref.current.material.centerAndScaleTexture = locals.centerAndScaleTexture
      ref.current.material.covAndColorTexture = locals.covAndColorTexture

      worker.onmessage = (e) => {
        if (ref.current) {
          let indexes = new Uint32Array(e.data.sortedIndexes)
          ref.current.geometry.attributes.splatIndex.set(indexes)
          ref.current.geometry.attributes.splatIndex.needsUpdate = true
          ref.current.geometry.instanceCount = indexes.length
          locals.sortReady = true
        }
      }

      // Wait until texture is ready
      while (true) {
        const centerAndScaleTextureProperties = gl.properties.get(locals.centerAndScaleTexture)
        const covAndColorTextureProperties = gl.properties.get(locals.covAndColorTexture)
        if (centerAndScaleTextureProperties?.__webglTexture && centerAndScaleTextureProperties?.__webglTexture) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      locals.sortReady = true
    }

    function pushDataBuffer(buffer, vertexCount) {
      if (locals.loadedVertexCount + vertexCount > locals.maxVertexes) {
        //console.log('vertexCount limited to ', locals.maxVertexes, vertexCount)
        vertexCount = locals.maxVertexes - locals.loadedVertexCount
      }
      if (vertexCount <= 0) return

      let u_buffer = new Uint8Array(buffer)
      let f_buffer = new Float32Array(buffer)
      let matrices = new Float32Array(vertexCount * 16)

      const covAndColorData_uint8 = new Uint8Array(locals.covAndColorData.buffer)
      const covAndColorData_int16 = new Int16Array(locals.covAndColorData.buffer)
      for (let i = 0; i < vertexCount; i++) {
        let quat = new THREE.Quaternion(
          (u_buffer[32 * i + 28 + 1] - 128) / 128.0,
          (u_buffer[32 * i + 28 + 2] - 128) / 128.0,
          -(u_buffer[32 * i + 28 + 3] - 128) / 128.0,
          (u_buffer[32 * i + 28 + 0] - 128) / 128.0
        )
        let center = new THREE.Vector3(f_buffer[8 * i + 0], f_buffer[8 * i + 1], -f_buffer[8 * i + 2])
        let scale = new THREE.Vector3(f_buffer[8 * i + 3 + 0], f_buffer[8 * i + 3 + 1], f_buffer[8 * i + 3 + 2])

        let mtx = new THREE.Matrix4()
        mtx.makeRotationFromQuaternion(quat)
        mtx.transpose()
        mtx.scale(scale)
        let mtx_t = mtx.clone()
        mtx.transpose()
        mtx.premultiply(mtx_t)
        mtx.setPosition(center)

        let cov_indexes = [0, 1, 2, 5, 6, 10]
        let max_value = 0.0
        for (let j = 0; j < cov_indexes.length; j++) {
          if (Math.abs(mtx.elements[cov_indexes[j]]) > max_value) {
            max_value = Math.abs(mtx.elements[cov_indexes[j]])
          }
        }

        let destOffset = locals.loadedVertexCount * 4 + i * 4
        locals.centerAndScaleData[destOffset + 0] = center.x
        locals.centerAndScaleData[destOffset + 1] = center.y
        locals.centerAndScaleData[destOffset + 2] = center.z
        locals.centerAndScaleData[destOffset + 3] = max_value / 32767.0

        destOffset = locals.loadedVertexCount * 8 + i * 4 * 2
        for (let j = 0; j < cov_indexes.length; j++) {
          covAndColorData_int16[destOffset + j] = parseInt((mtx.elements[cov_indexes[j]] * 32767.0) / max_value)
        }

        // RGBA
        destOffset = locals.loadedVertexCount * 16 + (i * 4 + 3) * 4
        covAndColorData_uint8[destOffset + 0] = u_buffer[32 * i + 24 + 0]
        covAndColorData_uint8[destOffset + 1] = u_buffer[32 * i + 24 + 1]
        covAndColorData_uint8[destOffset + 2] = u_buffer[32 * i + 24 + 2]
        covAndColorData_uint8[destOffset + 3] = u_buffer[32 * i + 24 + 3]

        // Store scale and transparent to remove splat in sorting process
        mtx.elements[15] = (Math.max(scale.x, scale.y, scale.z) * u_buffer[32 * i + 24 + 3]) / 255.0

        for (let j = 0; j < 16; j++) {
          matrices[i * 16 + j] = mtx.elements[j]
        }
      }

      while (vertexCount > 0) {
        let width = 0
        let height = 0
        let xoffset = locals.loadedVertexCount % locals.bufferTextureWidth
        let yoffset = Math.floor(locals.loadedVertexCount / locals.bufferTextureWidth)
        if (locals.loadedVertexCount % locals.bufferTextureWidth != 0) {
          width = Math.min(locals.bufferTextureWidth, xoffset + vertexCount) - xoffset
          height = 1
        } else if (Math.floor(vertexCount / locals.bufferTextureWidth) > 0) {
          width = locals.bufferTextureWidth
          height = Math.floor(vertexCount / locals.bufferTextureWidth)
        } else {
          width = vertexCount % locals.bufferTextureWidth
          height = 1
        }

        const centerAndScaleTextureProperties = gl.properties.get(locals.centerAndScaleTexture)
        context.bindTexture(context.TEXTURE_2D, centerAndScaleTextureProperties.__webglTexture)
        context.texSubImage2D(
          context.TEXTURE_2D,
          0,
          xoffset,
          yoffset,
          width,
          height,
          context.RGBA,
          context.FLOAT,
          locals.centerAndScaleData,
          locals.loadedVertexCount * 4
        )

        const covAndColorTextureProperties = gl.properties.get(locals.covAndColorTexture)
        context.bindTexture(context.TEXTURE_2D, covAndColorTextureProperties.__webglTexture)
        context.texSubImage2D(
          context.TEXTURE_2D,
          0,
          xoffset,
          yoffset,
          width,
          height,
          context.RGBA_INTEGER,
          context.UNSIGNED_INT,
          locals.covAndColorData,
          locals.loadedVertexCount * 4
        )

        locals.loadedVertexCount += width * height
        vertexCount -= width * height
      }

      worker.postMessage({ method: 'push', matrices: matrices.buffer }, [matrices.buffer])
    }

    function processPlyBuffer(inputBuffer) {
      const ubuf = new Uint8Array(inputBuffer)
      // 10KB ought to be enough for a header...
      const header = new TextDecoder().decode(ubuf.slice(0, 1024 * 10))
      const header_end = 'end_header\n'
      const header_end_index = header.indexOf(header_end)
      if (header_end_index < 0) throw new Error('Unable to read .ply file header')
      const vertexCount = parseInt(/element vertex (\d+)\n/.exec(header)[1])
      //console.log('Vertex Count', vertexCount)
      let row_offset = 0,
        offsets = {},
        types = {}
      const TYPE_MAP = {
        double: 'getFloat64',
        int: 'getInt32',
        uint: 'getUint32',
        float: 'getFloat32',
        short: 'getInt16',
        ushort: 'getUint16',
        uchar: 'getUint8'
      }
      for (let prop of header
        .slice(0, header_end_index)
        .split('\n')
        .filter((k) => k.startsWith('property '))) {
        const [p, type, name] = prop.split(' ')
        const arrayType = TYPE_MAP[type] || 'getInt8'
        types[name] = arrayType
        offsets[name] = row_offset
        row_offset += parseInt(arrayType.replace(/[^\d]/g, '')) / 8
      }
      //console.log('Bytes per row', row_offset, types, offsets)

      let dataView = new DataView(inputBuffer, header_end_index + header_end.length)
      let row = 0
      const attrs = new Proxy(
        {},
        {
          get(target, prop) {
            if (!types[prop]) throw new Error(prop + ' not found')
            return dataView[types[prop]](row * row_offset + offsets[prop], true)
          }
        }
      )

      console.time('calculate importance')
      let sizeList = new Float32Array(vertexCount)
      let sizeIndex = new Uint32Array(vertexCount)
      for (row = 0; row < vertexCount; row++) {
        sizeIndex[row] = row
        if (!types['scale_0']) continue
        const size = Math.exp(attrs.scale_0) * Math.exp(attrs.scale_1) * Math.exp(attrs.scale_2)
        const opacity = 1 / (1 + Math.exp(-attrs.opacity))
        sizeList[row] = size * opacity
      }
      console.timeEnd('calculate importance')

      console.time('sort')
      sizeIndex.sort((b, a) => sizeList[a] - sizeList[b])
      console.timeEnd('sort')

      // 6*4 + 4 + 4 = 8*4
      // XYZ - Position (Float32)
      // XYZ - Scale (Float32)
      // RGBA - colors (uint8)
      // IJKL - quaternion/rot (uint8)
      const rowLength = 3 * 4 + 3 * 4 + 4 + 4
      const buffer = new ArrayBuffer(rowLength * vertexCount)

      console.time('build buffer')
      for (let j = 0; j < vertexCount; j++) {
        row = sizeIndex[j]

        const position = new Float32Array(buffer, j * rowLength, 3)
        const scales = new Float32Array(buffer, j * rowLength + 4 * 3, 3)
        const rgba = new Uint8ClampedArray(buffer, j * rowLength + 4 * 3 + 4 * 3, 4)
        const rot = new Uint8ClampedArray(buffer, j * rowLength + 4 * 3 + 4 * 3 + 4, 4)

        if (types['scale_0']) {
          const qlen = Math.sqrt(attrs.rot_0 ** 2 + attrs.rot_1 ** 2 + attrs.rot_2 ** 2 + attrs.rot_3 ** 2)

          rot[0] = (attrs.rot_0 / qlen) * 128 + 128
          rot[1] = (attrs.rot_1 / qlen) * 128 + 128
          rot[2] = (attrs.rot_2 / qlen) * 128 + 128
          rot[3] = (attrs.rot_3 / qlen) * 128 + 128

          scales[0] = Math.exp(attrs.scale_0)
          scales[1] = Math.exp(attrs.scale_1)
          scales[2] = Math.exp(attrs.scale_2)
        } else {
          scales[0] = 0.01
          scales[1] = 0.01
          scales[2] = 0.01

          rot[0] = 255
          rot[1] = 0
          rot[2] = 0
          rot[3] = 0
        }

        position[0] = attrs.x
        position[1] = attrs.y
        position[2] = attrs.z

        if (types['f_dc_0']) {
          const SH_C0 = 0.28209479177387814
          rgba[0] = (0.5 + SH_C0 * attrs.f_dc_0) * 255
          rgba[1] = (0.5 + SH_C0 * attrs.f_dc_1) * 255
          rgba[2] = (0.5 + SH_C0 * attrs.f_dc_2) * 255
        } else {
          rgba[0] = attrs.red
          rgba[1] = attrs.green
          rgba[2] = attrs.blue
        }
        if (types['opacity']) {
          rgba[3] = (1 / (1 + Math.exp(-attrs.opacity))) * 255
        } else {
          rgba[3] = 255
        }
      }
      console.timeEnd('build buffer')
      return buffer
    }

    run()
  }, [src])

  const pm = new THREE.Matrix4()
  function getProjectionMatrix() {
    let mtx = pm.copy(camera.projectionMatrix)
    mtx.elements[4] *= -1
    mtx.elements[5] *= -1
    mtx.elements[6] *= -1
    mtx.elements[7] *= -1
    return mtx
  }

  let vm1 = new THREE.Matrix4()
  let vm2 = new THREE.Matrix4()
  function getModelViewMatrix(m) {
    const viewMatrix = vm1.copy(camera.matrixWorld)
    viewMatrix.elements[1] *= -1.0
    viewMatrix.elements[4] *= -1.0
    viewMatrix.elements[6] *= -1.0
    viewMatrix.elements[9] *= -1.0
    viewMatrix.elements[13] *= -1.0
    const mtx = vm2.copy(obj.current.matrixWorld)
    mtx.invert()
    mtx.elements[1] *= -1.0
    mtx.elements[4] *= -1.0
    mtx.elements[6] *= -1.0
    mtx.elements[9] *= -1.0
    mtx.elements[13] *= -1.0
    mtx.multiply(viewMatrix)
    mtx.invert()
    return mtx
  }

  let viewport = new THREE.Vector4()
  useFrame((state, delta) => {
    camera.updateMatrixWorld()
    let projectionMatrix = getProjectionMatrix()
    ref.current.material.gsProjectionMatrix = projectionMatrix
    ref.current.material.gsModelViewMatrix = getModelViewMatrix()
    gl.getCurrentViewport(viewport)
    const focal = (viewport.w / 2.0) * Math.abs(projectionMatrix.elements[5])
    ref.current.material.viewport[0] = viewport.z
    ref.current.material.viewport[1] = viewport.w
    ref.current.material.focal = focal

    if (locals.sortReady) {
      locals.sortReady = false
      let camera_mtx = getModelViewMatrix().elements
      let view = new Float32Array([camera_mtx[2], camera_mtx[6], camera_mtx[10], camera_mtx[14]])
      worker.postMessage({ method: 'sort', view: view.buffer, cutout: undefined }, [view.buffer])
    }
  })

  return (
    <group ref={obj} frustumCulled={false} {...props}>
      <mesh ref={ref} frustumCulled={false}>
        <splatMaterial transparent depthWrite={false} depthTest blending={THREE.CustomBlending} blendSrcAlpha={THREE.OneFactor} />
      </mesh>
    </group>
  )
})
