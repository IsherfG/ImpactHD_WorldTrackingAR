import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import "./qr.js"; // Assuming qr.js is necessary for your setup

import "./style.css";

let container;
let camera, scene, renderer;
let controller;

let reticle;

let object1, object2, object3, object4, object5; // To store loaded GLTF scenes

let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

const DEFAULT_OBJECT_SCALE = 0.2;
let currentScale = DEFAULT_OBJECT_SCALE; // This will hold the scale for the NEXT object or current manipulated one
let lastPlacedObject = null; // This will always point to the latest placed/interacted object for gestures

// let allPlacedObjects = []; // Optional: to manage all objects for more complex interactions

let selectedObject = "obj1";

let initialPinchDistance = null;
let pinchScaling = false;
let initialPinchAngle = null;
let pinchRotating = false;

let moving = false;
let initialTouchPosition = null;
const MOVE_SENSITIVITY = 0.0025;

let threeFingerMoving = false;
let initialZPosition = null;
let initialThreeFingerY = null;

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
}

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.5);
  hemiLight.position.set(0.5, 1, 0.25);
  scene.add(hemiLight);
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);
  renderer.xr.addEventListener("sessionstart", sessionStart);

  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["local", "hit-test", "dom-overlay"],
    domOverlay: { root: document.querySelector("#overlay") },
  });
  document.body.appendChild(arButton);

  document.getElementById("place-object-btn").addEventListener("click", onSelect);
  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (lastPlacedObject) {
      scene.remove(lastPlacedObject);
      // Basic disposal, might need more for complex objects if memory is an issue
      lastPlacedObject.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose());
            else child.material.dispose();
          }
        }
      });
      // allPlacedObjects = allPlacedObjects.filter(obj => obj !== lastPlacedObject); // If using array
      lastPlacedObject = null; // No object is actively targeted now
      document.getElementById("delete-object-btn").style.display = "none";
      // currentScale = DEFAULT_OBJECT_SCALE; // Reset scale for next NEW placement (or keep it as is)
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
        const mesh = modelToClone.clone();
        document.getElementById("delete-object-btn").style.display = "flex";

        const newPosition = new THREE.Vector3();
        const newQuaternion = new THREE.Quaternion();
        const tempScale = new THREE.Vector3(); // To absorb reticle's scale if any

        reticle.matrix.decompose(newPosition, newQuaternion, tempScale);
        mesh.position.copy(newPosition);
        mesh.quaternion.copy(newQuaternion);

        // New objects will use the `currentScale`. `currentScale` is updated
        // by pinch gestures on the `lastPlacedObject`.
        // If you want new objects to always be DEFAULT_OBJECT_SCALE:
        // mesh.scale.set(DEFAULT_OBJECT_SCALE, DEFAULT_OBJECT_SCALE, DEFAULT_OBJECT_SCALE);
        // And currentScale = DEFAULT_OBJECT_SCALE; when an object is deleted or deselected.
        mesh.scale.set(currentScale, currentScale, currentScale);

        const cameraLookAt = new THREE.Vector3();
        camera.getWorldPosition(cameraLookAt);
        mesh.lookAt(cameraLookAt.x, mesh.position.y, cameraLookAt.z);

        scene.add(mesh);
        lastPlacedObject = mesh; // The new mesh is now the one to be manipulated
        // allPlacedObjects.push(mesh); // If using array

        const targetScaleVal = mesh.scale.x; // Animate to the scale it was just set to
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
  shelfTexture.flipY = false;
  gltfLoader.load("Shelf2.glb", (gltf) => {
    object2 = gltf.scene;
    object2.traverse(n => { if (n.isMesh) { const m = n.material.clone(); m.map = shelfTexture; m.needsUpdate = true; n.material = m; }});
  }, undefined, loadErrorCallback("Shelf2.glb"));
  const bagTexture = textureLoader.load("Map1.png", undefined, undefined, loadErrorCallback("Map1.png"));
  bagTexture.flipY = false;
  gltfLoader.load("Bag1.glb", (gltf) => {
    object3 = gltf.scene;
    object3.traverse(n => { if (n.isMesh) { const m = n.material.clone(); m.map = bagTexture; m.needsUpdate = true; n.material = m; }});
  }, undefined, loadErrorCallback("Bag1.glb"));
  const bagTexture2 = textureLoader.load("Map2.jpg", undefined, undefined, loadErrorCallback("Map2.jpg"));
  bagTexture2.flipY = false;
  gltfLoader.load("Bag2.glb", (gltf) => {
    object4 = gltf.scene;
    object4.traverse(n => { if (n.isMesh) { const m = n.material.clone(); m.map = bagTexture2; m.needsUpdate = true; n.material = m; }});
  }, undefined, loadErrorCallback("Bag2.glb"));
  const bagTexture3 = textureLoader.load("Map3.png", undefined, undefined, loadErrorCallback("Map3.png"));
  bagTexture3.flipY = false;
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
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();
    if (hitTestSourceRequested === false && session) {
      session.requestReferenceSpace("viewer").then((refSpace) => {
        session.requestHitTestSource({ space: refSpace })
          .then((source) => { hitTestSource = source; })
          .catch(err => console.error("Hit test source error:", err));
      }).catch(err => console.error("Viewer ref space error:", err));
      session.addEventListener("end", () => {
        hitTestSourceRequested = false; hitTestSource = null; planeFound = false;
        document.getElementById("tracking-prompt").style.display = "none";
        document.getElementById("instructions").style.display = "none";
        document.getElementById("button-container").style.display = "none";
        // Clean up all objects on session end if you used an array:
        // allPlacedObjects.forEach(obj => scene.remove(obj));
        // allPlacedObjects = [];
        if (lastPlacedObject) scene.remove(lastPlacedObject); // Or just the last one
        lastPlacedObject = null;
        currentScale = DEFAULT_OBJECT_SCALE;
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
        if (hit && hit.getPose) {
            const pose = hit.getPose(referenceSpace);
            if (pose) { reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix); }
            else { reticle.visible = false; }
        } else { reticle.visible = false; }
      } else { reticle.visible = false; }
    }
  }
  renderer.render(scene, camera);
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
    // Capture the scale of the object we are about to pinch
    // This currentScale is temporary for this gesture, the global currentScale
    // is used for new object placements and updated on pinch end.
    // Let's rename this to objectScaleAtPinchStart for clarity
    // For now, using the global currentScale and updating it directly is fine
    // if gestures always apply to lastPlacedObject and its scale is what currentScale tracks
    currentScale = lastPlacedObject.scale.x; // This is correct if currentScale tracks the active object's scale
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
    // currentScale here is the scale of the object *at the start of this pinch*
    const newObjectScale = currentScale * scaleChange;
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

    const moveX = dxScreen * MOVE_SENSITIVITY;
    const moveZ = dyScreen * MOVE_SENSITIVITY;

    const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
    camDir.y = 0; camDir.normalize();
    const camRight = new THREE.Vector3().crossVectors(camera.up, camDir).normalize();
    // If X is inverted, camRight.negate() or use crossVectors(camDir, camera.up)

    const worldMove = new THREE.Vector3();
    worldMove.addScaledVector(camRight, moveX);
    worldMove.addScaledVector(camDir, moveZ); // If Z is inverted (drag down moves away vs towards), negate moveZ or camDir scaling

    lastPlacedObject.position.x += worldMove.x;
    lastPlacedObject.position.z += worldMove.z;
    initialTouchPosition.copy(currentTouch);
  }
}

function onTouchEnd(event) {
  if (threeFingerMoving && event.touches.length < 3) threeFingerMoving = false;
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if (lastPlacedObject) {
      currentScale = lastPlacedObject.scale.x; // Update global currentScale for next placement/gesture
    }
    pinchScaling = false; pinchRotating = false;
  }
  if (moving && event.touches.length < 1) moving = false;
  if (event.touches.length === 0) { // Reset all if no fingers left
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