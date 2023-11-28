import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  MeshTransmissionMaterial,
  Environment,
} from "@react-three/drei";
import { useFBO } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { RoundedBox } from "@react-three/drei";
import { Splat } from "./splat";
import { useTexture } from "@react-three/drei";
import { useControls } from "leva";

import {DepthBG} from "./DepthBG";


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
  const normalMap = useTexture("glass1.jpg");
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
      <group ref={ref0}>
        <DepthBG />
        <Splat
          ref={ref}
          scale={1.4}
          rotation={[0, rotation, 0]}
          position={[0, -0.4, 0.2]}
          // will have to change scale for this one
          // src="oleksii_zolotariov_sculpture.splat"
          src="maty.splat"
        />
      </group>

      <RoundedBox
        ref={ref1}
        position={[0, 0, 0.8]}
        args={[1.5, 2, 0.2]}
        radius={0.04}
      >
        <MeshTransmissionMaterial
          ref={material}
          transmission={transmission}
          roughness={roughness}
          thickness={0.1}
          normalMap={normalMap}
          normalScale={[0.1, 0.1]}
          color={color}
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
        <color attach="background" args={["#111111"]} />
        <Environment preset="warehouse" blur={1} />
        <OrbitControls />
        <ambientLight />
        <pointLight position={[10, 10, 10]} />
        <GlassModel />
      </Canvas>
    </>
  );
}

export default App;
