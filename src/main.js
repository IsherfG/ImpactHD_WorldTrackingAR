import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import "./qr.js";

import "./style.css";

let container;
let camera, scene, renderer;
let controller;

let reticle;

let object1, object2, object3, object4, object5;

let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

const DEFAULT_OBJECT_SCALE = 0.2;
let currentScale = DEFAULT_OBJECT_SCALE;
let lastPlacedObject = null;

let selectedObject = "obj1";

let initialPinchDistance = null;
let pinchScaling = false;
let initialPinchAngle = null;
let pinchRotating = false;

let moving = false;
let initialTouchPosition = null;
const MOVE_SENSITIVITY = 0.002;

let threeFingerMoving = false;
let initialZPosition = null;
let initialThreeFingerY = null;

// Path to your HDR environment map.
// Download one from polyhaven.com (e.g., "venice_sunset_1k.hdr")
// and place it in your public assets folder.
const HDR_ENVIRONMENT_MAP_PATH = 'hdr.hdr'; // REPLACE WITH YOUR ACTUAL PATH

if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    if (supported) {
      document.getElementById("ar-not-supported").style.display = "none";
      init();
      animate();
    } else {
      document.getElementById("ar-not-supported").innerHTML =
        "Immersive AR not supported. Try on a compatible mobile device.";
      const arButtonElement = document.querySelector("#ARButton") || document.querySelector(".ar-button");
      if (arButtonElement) arButtonElement.style.display = "none";
    }
  }).catch((err) => {
    console.error("Error checking AR support:", err);
    document.getElementById("ar-not-supported").innerHTML = "Error checking AR support.";
  });
} else {
  document.getElementById("ar-not-supported").innerHTML = "WebXR API not found. Try a modern browser.";
}

function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "block";
  document.getElementById("instructions").style.display = "none";
  document.getElementById("button-container").style.display = "none";

  // When AR session starts, if an environment map was loaded for non-AR,
  // you might want to make the scene background transparent for AR.
  // However, scene.environment will still affect PBR material reflections.
  if (scene.background && renderer.xr.isPresenting) {
    // scene.background = null; // Make background transparent for AR
  }
}

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  // --- LIGHTING ENHANCEMENTS ---
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.6); // Adjusted intensity
  hemiLight.position.set(0.5, 1, 0.25);
  scene.add(hemiLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // Adjusted intensity
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1.5, 2, 1).normalize(); // Angled for better shadows
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 1024;
  directionalLight.shadow.mapSize.height = 1024;
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 10; // Reduced far for AR context
  directionalLight.shadow.camera.left = -2;
  directionalLight.shadow.camera.right = 2;
  directionalLight.shadow.camera.top = 2;
  directionalLight.shadow.camera.bottom = -2;
  directionalLight.shadow.bias = -0.001; // Adjusted bias
  scene.add(directionalLight);
  // const dirLightHelper = new THREE.DirectionalLightHelper(directionalLight, 1);
  // scene.add(dirLightHelper);
  // const shadowCamHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
  // scene.add(shadowCamHelper);
  // --- END LIGHTING ---

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  // --- RENDERER SETTINGS FOR PBR ---
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0; // Can be adjusted
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // --- END RENDERER SETTINGS ---

  container.appendChild(renderer.domElement);
  renderer.xr.addEventListener("sessionstart", sessionStart);

  // --- ENVIRONMENT MAP ---
  // This will provide reflections and image-based lighting for PBR materials.
  // Ensure the HDR_ENVIRONMENT_MAP_PATH is correct and the file is accessible.
  new RGBELoader()
    .setPath('') // Assuming HDR is in the same public root or a relative path from it
    .load(HDR_ENVIRONMENT_MAP_PATH, function (texture) {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture; // Apply to materials for reflections
      // scene.background = texture; // Uncomment to see HDR as background (usually not for AR)
      console.log("Environment map '" + HDR_ENVIRONMENT_MAP_PATH + "' loaded.");
    }, undefined, function(error) {
        console.error(`Could not load HDR environment map from '${HDR_ENVIRONMENT_MAP_PATH}':`, error);
    });
  // --- END ENVIRONMENT MAP ---

  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  document.body.appendChild(arButton);

  document.getElementById("place-object-btn").addEventListener("click", onSelect);
  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (lastPlacedObject) {
      scene.remove(lastPlacedObject);
      // Consider more thorough disposal if models are very complex or many unique ones are placed
      lastPlacedObject.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(mat => {
                if(mat.map) mat.map.dispose(); // Dispose textures if loaded per material instance
                mat.dispose();
            });
            else {
                if(child.material.map) child.material.map.dispose();
                child.material.dispose();
            }
          }
        }
      });
      lastPlacedObject = null;
      document.getElementById("delete-object-btn").style.display = "none";
    }
  });

  document.getElementById("object1").addEventListener("click", (e) => { e.stopPropagation(); selectedObject = "obj1"; });
  document.getElementById("object2").addEventListener("click", (e) => { e.stopPropagation(); selectedObject = "obj2"; });
  document.getElementById("object3").addEventListener("click", (e) => { e.stopPropagation(); selectedObject = "obj3"; });
  document.getElementById("object4").addEventListener("click", (e) => { e.stopPropagation(); selectedObject = "obj4"; });
  document.getElementById("object5").addEventListener("click", (e) => { e.stopPropagation(); selectedObject = "obj5"; });

  function onSelect() {
    if (reticle.visible) {
      let modelToClone;
      if (selectedObject === "obj1" && object1) modelToClone = object1;
      else if (selectedObject === "obj2" && object2) modelToClone = object2;
      else if (selectedObject === "obj3" && object3) modelToClone = object3;
      else if (selectedObject === "obj4" && object4) modelToClone = object4;
      else if (selectedObject === "obj5" && object5) modelToClone = object5;

      if (modelToClone) {
        const mesh = modelToClone.clone(); // Clones the entire GLTF scene
        document.getElementById("delete-object-btn").style.display = "flex";

        // --- ENABLE SHADOWS ON PLACED OBJECT ---
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.traverse(function (child) {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                // Optional: Ensure MeshStandardMaterial for better PBR rendering
                // if (!(child.material instanceof THREE.MeshStandardMaterial)) {
                //     const oldMaterial = child.material;
                //     child.material = new THREE.MeshStandardMaterial({
                //         map: oldMaterial.map || null, // Preserve texture if any
                //         color: oldMaterial.color || 0xffffff,
                //         // metalness: 0.1, // default
                //         // roughness: 0.7, // default
                //     });
                //     oldMaterial.dispose(); // Dispose old material
                // }
            }
        });
        // --- END SHADOWS ---

        const newPosition = new THREE.Vector3();
        const newQuaternion = new THREE.Quaternion();
        const tempScale = new THREE.Vector3();

        reticle.matrix.decompose(newPosition, newQuaternion, tempScale);
        mesh.position.copy(newPosition);
        mesh.quaternion.copy(newQuaternion);
        mesh.scale.set(currentScale, currentScale, currentScale);

        const cameraLookAt = new THREE.Vector3();
        camera.getWorldPosition(cameraLookAt);
        mesh.lookAt(cameraLookAt.x, mesh.position.y, cameraLookAt.z);

        scene.add(mesh);
        lastPlacedObject = mesh;

        const targetScaleVal = mesh.scale.x;
        const startAnimScaleFactor = 0.1;
        mesh.scale.set(
          targetScaleVal * startAnimScaleFactor,
          targetScaleVal * startAnimScaleFactor,
          targetScaleVal * startAnimScaleFactor
        );

        const animationDuration = 300;
        const startTime = performance.now();
        function animateEntry() {
          if (!mesh.parent) return;
          const elapsedTime = performance.now() - startTime;
          if (elapsedTime >= animationDuration) {
            mesh.scale.set(targetScaleVal, targetScaleVal, targetScaleVal);
            return;
          }
          const progress = elapsedTime / animationDuration;
          const easedProgress = 1 - Math.pow(1 - progress, 3);
          const newAnimScale = targetScaleVal * startAnimScaleFactor + targetScaleVal * (1 - startAnimScaleFactor) * easedProgress;
          mesh.scale.set(newAnimScale, newAnimScale, newAnimScale);
          requestAnimationFrame(animateEntry);
        }
        requestAnimationFrame(animateEntry);
      }
    }
  }

  controller = renderer.xr.getController(0);
  scene.add(controller);

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.1, 24, 1, 0, Math.PI * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const gltfLoader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  const loadErrorCallback = (name) => (error) => console.error(`Error loading ${name}:`, error);

  gltfLoader.load("Shelf.glb", (gltf) => { object1 = gltf.scene; }, undefined, loadErrorCallback("Shelf.glb"));
  const shelfTexture = textureLoader.load("Shelf.png", undefined, undefined, loadErrorCallback("Shelf.png"));
  shelfTexture.flipY = false; // GLTF convention
  shelfTexture.encoding = THREE.sRGBEncoding; // Ensure textures are interpreted correctly with sRGB output
  gltfLoader.load("Shelf2.glb", (gltf) => {
    object2 = gltf.scene;
    object2.traverse(n => { if (n.isMesh) { const m = n.material.clone(); m.map = shelfTexture; m.needsUpdate = true; n.material = m; }});
  }, undefined, loadErrorCallback("Shelf2.glb"));

  const bagTexture = textureLoader.load("Map1.png", undefined, undefined, loadErrorCallback("Map1.png"));
  bagTexture.flipY = false;
  bagTexture.encoding = THREE.sRGBEncoding;
  gltfLoader.load("Bag1.glb", (gltf) => {
    object3 = gltf.scene;
    object3.traverse(n => { if (n.isMesh) { const m = n.material.clone(); m.map = bagTexture; m.needsUpdate = true; n.material = m; }});
  }, undefined, loadErrorCallback("Bag1.glb"));

  const bagTexture2 = textureLoader.load("Map2.jpg", undefined, undefined, loadErrorCallback("Map2.jpg"));
  bagTexture2.flipY = false;
  bagTexture2.encoding = THREE.sRGBEncoding;
  gltfLoader.load("Bag2.glb", (gltf) => {
    object4 = gltf.scene;
    object4.traverse(n => { if (n.isMesh) { const m = n.material.clone(); m.map = bagTexture2; m.needsUpdate = true; n.material = m; }});
  }, undefined, loadErrorCallback("Bag2.glb"));

  const bagTexture3 = textureLoader.load("Map3.png", undefined, undefined, loadErrorCallback("Map3.png"));
  bagTexture3.flipY = false;
  bagTexture3.encoding = THREE.sRGBEncoding;
  gltfLoader.load("Bag3.glb", (gltf) => {
    object5 = gltf.scene;
    object5.traverse(n => { if (n.isMesh) { const m = n.material.clone(); m.map = bagTexture3; m.needsUpdate = true; n.material = m; }});
  }, undefined, loadErrorCallback("Bag3.glb"));

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, false);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  // The AR session will handle clearing and drawing the camera feed.
  // We just need to render our 3D scene on top.
  if (frame) { // Only process if we have an XRFrame
    const referenceSpace = renderer.xr.getReferenceSpace(); // Should be 'local'
    const session = renderer.xr.getSession();

    if (hitTestSourceRequested === false && session) { // Ensure session is active
      session.requestReferenceSpace("viewer").then((viewerRefSpace) => {
        session.requestHitTestSource({ space: viewerRefSpace })
          .then((source) => { hitTestSource = source; })
          .catch(err => console.error("Hit test source error:", err));
      }).catch(err => console.error("Viewer ref space error:", err));

      session.addEventListener("end", () => {
        hitTestSourceRequested = false; hitTestSource = null; planeFound = false;
        document.getElementById("tracking-prompt").style.display = "none";
        document.getElementById("instructions").style.display = "none";
        document.getElementById("button-container").style.display = "none";
        if (lastPlacedObject) scene.remove(lastPlacedObject); // Clean up object
        lastPlacedObject = null;
        currentScale = DEFAULT_OBJECT_SCALE;
        // scene.environment = null; // Optionally clear env map if it was only for non-AR
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource && referenceSpace) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length) {
        if (!planeFound) {
          planeFound = true;
          document.getElementById("tracking-prompt").style.display = "none";
          document.getElementById("instructions").style.display = "flex";
          document.getElementById("button-container").style.display = "flex";
        }
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);
        if (pose) {
            reticle.visible = true;
            reticle.matrix.fromArray(pose.transform.matrix);
        } else {
            reticle.visible = false;
        }
      } else {
        reticle.visible = false;
      }
    }
  }
  renderer.render(scene, camera); // This renders our 3D content.
                                   // In an AR session, the camera's projection matrix
                                   // and view matrix are updated by WebXR.
}

function onTouchStart(event) {
  if (event.touches.length === 3 && lastPlacedObject) {
    threeFingerMoving = true;
    initialZPosition = lastPlacedObject.position.y;
    initialThreeFingerY = event.touches[0].pageY;
    pinchScaling = pinchRotating = moving = false;
  } else if (event.touches.length === 2 && lastPlacedObject) {
    pinchScaling = true; pinchRotating = true;
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
    currentScale = lastPlacedObject.scale.x; // Capture current object scale for relative pinch
    moving = threeFingerMoving = false;
  } else if (event.touches.length === 1 && lastPlacedObject) {
    let targetElement = event.target; let ignoreTap = false;
    while(targetElement && targetElement !== document.body) {
        if (targetElement.dataset && targetElement.dataset.ignoreTap === 'true') { ignoreTap = true; break; }
        targetElement = targetElement.parentElement;
    }
    if (!ignoreTap) {
        moving = true;
        initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
        pinchScaling = pinchRotating = threeFingerMoving = false;
    }
  }
}

function onTouchMove(event) {
  if (threeFingerMoving && event.touches.length === 3 && lastPlacedObject) {
    const deltaY = initialThreeFingerY - event.touches[0].pageY;
    lastPlacedObject.position.y = initialZPosition + (deltaY * 0.005);
  } else if (pinchScaling && event.touches.length === 2 && lastPlacedObject) {
    const newPinchDistance = getPinchDistance(event.touches);
    const scaleChange = newPinchDistance / initialPinchDistance;
    const newObjectScale = currentScale * scaleChange; // Scale relative to scale at pinch start
    lastPlacedObject.scale.set(newObjectScale, newObjectScale, newObjectScale);
    if (pinchRotating) {
      const newPinchAngle = getPinchAngle(event.touches);
      lastPlacedObject.rotation.y += (newPinchAngle - initialPinchAngle);
      initialPinchAngle = newPinchAngle;
    }
  } else if (moving && event.touches.length === 1 && lastPlacedObject) {
    const currentTouch = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    const dxScreen = currentTouch.x - initialTouchPosition.x;
    const dyScreen = currentTouch.y - initialTouchPosition.y;

    const cameraRight = new THREE.Vector3();
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    cameraRight.y = 0;
    cameraRight.normalize();

    const cameraForward = new THREE.Vector3();
    cameraForward.setFromMatrixColumn(camera.matrixWorld, 2);
    cameraForward.negate();
    cameraForward.y = 0;
    cameraForward.normalize();

    const worldMoveX = cameraRight.clone().multiplyScalar(dxScreen * MOVE_SENSITIVITY);
    const worldMoveZ = cameraForward.clone().multiplyScalar(-dyScreen * MOVE_SENSITIVITY); // Corrected based on last feedback

    lastPlacedObject.position.add(worldMoveX);
    lastPlacedObject.position.add(worldMoveZ);

    initialTouchPosition.copy(currentTouch);
  }
}

function onTouchEnd(event) {
  if (threeFingerMoving && event.touches.length < 3) threeFingerMoving = false;
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if (lastPlacedObject) {
      currentScale = lastPlacedObject.scale.x; // Update global currentScale for next object placement
    }
    pinchScaling = false; pinchRotating = false;
  }
  if (moving && event.touches.length < 1) moving = false;
  if (event.touches.length === 0) {
    threeFingerMoving = pinchScaling = pinchRotating = moving = false;
  }
}

function getPinchDistance(touches) {
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getPinchAngle(touches) {
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.atan2(dy, dx);
}