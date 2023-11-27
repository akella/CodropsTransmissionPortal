import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Model } from "./Mode";
import {
  MeshTransmissionMaterial,
  Sky,
  Environment,
  shaderMaterial,
} from "@react-three/drei";
import { useFBO } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { RoundedBox } from "@react-three/drei";
import { Splat } from "./splat";
import { useTexture } from "@react-three/drei";
import { useControls } from "leva";
import * as THREE from "three";
import { extend } from "@react-three/fiber";

function DepthBG() {
  const StripeMaterial = shaderMaterial(
    {  },
    // vertex shader
    /*glsl*/ `
      varying vec2 vUv;
      varying vec3 vPosition;
      void main() {
        vUv = uv;
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    // fragment shader
    /*glsl*/ `
      uniform float time;
      uniform vec3 color;
      varying vec2 vUv;
      varying vec3 vPosition;
      void main() {
        float stripes = smoothstep(0.95,1., sin(vPosition.z * 30.0 ));
        float fadeOut = smoothstep(-0.9, 0.1, vPosition.z);
        gl_FragColor.rgba = vec4(fadeOut*0.2*vec3(stripes), 1.0);
      }
    `
  );

  extend({ StripeMaterial });

  return (
    <mesh>
      <boxGeometry position={[0, 0, 0.8]} args={[1.5, 2, 1.5]} />
      <stripeMaterial color="hotpink" time={1} side={THREE.BackSide} />
    </mesh>
  );
}

function GlassModel() {
  const { roughness, transmission, rotation, showOriginal, color } =
    useControls({
      roughness: { value: 0.05, min: 0, max: 1 },
      transmission: { value: 1, min: 0, max: 1 },
      rotation: { value: 1.4 * Math.PI, min: 0, max: 2 * Math.PI },
      showOriginal: { value: false },
      color: { value: "#fff" },
    });
  const buffer = useFBO();
  const ref0 = useRef();
  const ref = useRef();
  const ref1 = useRef();
  const material = useRef();
  const normalMap = useTexture("/glass1.jpg");
  normalMap.wrapS = normalMap.wrapT = 1000;

  useFrame((state) => {
    ref0.current.visible = true;
    ref1.current.visible = false;
    state.gl.setRenderTarget(buffer);
    state.gl.render(state.scene, state.camera);
    state.gl.setRenderTarget(null);
    ref0.current.visible = showOriginal;
    ref1.current.visible = true;
  });

  return (
    <>
      {/* <Model ref={ref} scale={[20, 20, 20]} /> */}
      <group ref={ref0}>
        <DepthBG />
        <Splat
          ref={ref}
          scale={1.4}
          rotation={[0, rotation, 0]}
          position={[0, -0.4, 0.2]}
          // https://twitter.com/the_ross_man/status/1726815140535009785
          // src="dog-photos.splat"
          // src="gaussian_splatting_point_cloud1.splat"
          src="maty.splat"
        />
      </group>

      {/* <mesh ref={ref} position={[0,0,0]}>
          <boxGeometry args={[0.3, 0.3, 0.3]} />
          <meshStandardMaterial 
          color={'#fff00f'}
           />
        </mesh> */}
      <RoundedBox
        ref={ref1}
        position={[0, 0, 0.8]}
        args={[1.5, 2, 0.2]}
        radius={0.04}
      >
        {/* <boxGeometry args={[1.5, 2, 0.1]} /> */}
        <MeshTransmissionMaterial
          ref={material}
          transmission={transmission}
          // samples ={1}
          roughness={roughness}
          thickness={0.1}
          normalMap={normalMap}
          normalScale={[0.1, 0.1]}
          color={color}
          // backside={true}
          buffer={buffer.texture}
        />
      </RoundedBox>
    </>
  );
}

function App() {
  return (
    <>
      <Canvas camera={{ position: [0, 0, 3], fov: 75 }}>
        {/* <Sky /> */}
        <color attach="background" args={["#111111"]} />
        <Environment preset="warehouse" blur={1} />
        <OrbitControls />
        <ambientLight />
        <pointLight position={[10, 10, 10]} />

        <GlassModel />
        {/* <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="hotpink" />
        </mesh> */}
      </Canvas>
    </>
  );
}

export default App;
