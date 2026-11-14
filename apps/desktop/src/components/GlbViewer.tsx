import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { cx } from "@/components/ui";

/* The 3D lab's viewport. A generated mesh is the one asset in Aurea you
 * cannot judge from a thumbnail — the silhouette that reads well head-on is
 * routinely hollow from behind, and the seam the texture bake left is only
 * visible from one angle — so the lab has to let you turn it.
 *
 * Deliberately small: one light rig, orbit, a turntable you can stop, and a
 * wireframe toggle. Everything a person actually does to a fresh generation
 * ("is the back there? did the texture bake? how dense is it?") and nothing
 * else — this is a viewer, not a DCC tool.
 *
 * The GLBs carry their own PBR materials, so the rig is neutral on purpose: a
 * neutral studio environment plus a plain white key/fill/rim, which shows the
 * baked albedo honestly rather than flattering it.
 *
 * The environment map is not decoration. A metallic PBR material with no
 * environment has nothing to reflect and renders BLACK — the first textured
 * kettle through this viewer came out a near-black silhouette with a few
 * specular highlights on it, and the bake was fine. A viewer whose whole job
 * is "did the texture bake?" cannot answer that without an environment. */

/** Frame the camera on whatever came out of the loader. Generated meshes have
 * no agreed scale — Hunyuan normalises to roughly a unit cube, but a mesh
 * that arrives at 100x still has to be visible — so fit rather than assume. */
function frame(object: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
  // pull back far enough that the bounding sphere fits the vertical fov, with
  // a little air so the model is not jammed against the frame
  const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.4;

  object.position.sub(center);
  camera.position.set(distance * 0.6, distance * 0.35, distance * 0.8);
  camera.near = distance / 100;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  controls.update();
}

export function GlbViewer({
  url,
  className,
  /** slow turntable until the first drag — a still render of a still object
   * reads as a picture, and the whole point of this panel is that it isn't */
  autoRotate = true,
  wireframe = false,
}: {
  url: string;
  className?: string;
  autoRotate?: boolean;
  wireframe?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // held in refs so the toggles don't tear down and re-download the model
  const controlsRef = useRef<OrbitControls>(null);
  const rootRef = useRef<THREE.Object3D>(null);

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    setLoading(true);
    setError(null);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controlsRef.current = controls;

    // generated once and owned by this instance; PMREM allocates GPU targets
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 4, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(-4, 1, 3);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(0, 2, -5);
    scene.add(rim);

    let disposed = false;
    let raf = 0;
    let loaded: THREE.Object3D | undefined;

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (disposed) return;
        loaded = gltf.scene;
        rootRef.current = loaded;
        scene.add(loaded);
        frame(loaded, camera, controls);
        setLoading(false);
      },
      undefined,
      (err) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : "could not read this file");
        setLoading(false);
      },
    );

    // the panel is flex-sized, so the canvas follows the box rather than the
    // window — a plain resize listener misses every layout change
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      // a GL context per model would leak the card dry after a dozen previews
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        for (const material of [mesh.material].flat()) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) value.dispose();
          }
          material.dispose();
        }
      });
      pmrem.dispose();
      scene.environment?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      rootRef.current = null;
      controlsRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.6;
  }, [autoRotate, loading]);

  useEffect(() => {
    rootRef.current?.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of [mesh.material].flat()) {
        if ("wireframe" in material) (material as THREE.MeshStandardMaterial).wireframe = wireframe;
      }
    });
  }, [wireframe, loading]);

  return (
    <div className={cx("relative min-h-0 overflow-hidden", className)}>
      <div ref={host} className="h-full w-full" />
      {(loading || error) && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className={cx("text-xs", error ? "text-ember" : "text-fog")}>
            {error ? `Could not open this model — ${error}` : "Loading model…"}
          </p>
        </div>
      )}
    </div>
  );
}
