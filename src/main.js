import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
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
const MOVE_SENSITIVITY = 0.002; // Adjusted sensitivity, might need tuning

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
      lastPlacedObject.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(mat => mat.dispose());
            else child.material.dispose();
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
        const mesh = modelToClone.clone();
        document.getElementById("delete-object-btn").style.display = "flex";

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
        if (lastPlacedObject) scene.remove(lastPlacedObject);
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
    currentScale = lastPlacedObject.scale.x;
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
    const newObjectScale = currentScale * scaleChange;
    lastPlacedObject.scale.set(newObjectScale, newObjectScale, newObjectScale);
    if (pinchRotating) {
      const newPinchAngle = getPinchAngle(event.touches);
      lastPlacedObject.rotation.y += (newPinchAngle - initialPinchAngle);
      initialPinchAngle = newPinchAngle;
    }
  } else if (moving && event.touches.length === 1 && lastPlacedObject) {
    const currentTouch = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    const dxScreen = currentTouch.x - initialTouchPosition.x; // Positive: drag right
    const dyScreen = currentTouch.y - initialTouchPosition.y; // Positive: drag down

    // Get camera's local X-axis (Right vector) in world space
    const cameraRight = new THREE.Vector3();
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0); // Column 0 is X-axis
    cameraRight.y = 0; // Project onto XZ plane
    cameraRight.normalize();

    // Get camera's local Z-axis (Forward/LookAt vector) in world space
    // Cameras look down their negative Z-axis. So, the "forward" direction of view is -Z.
    const cameraForward = new THREE.Vector3();
    cameraForward.setFromMatrixColumn(camera.matrixWorld, 2); // Column 2 is Z-axis
    cameraForward.negate(); // Negate because camera looks down -Z. Now cameraForward points where camera is looking.
    cameraForward.y = 0; // Project onto XZ plane
    cameraForward.normalize();

    // Calculate world space movement amounts
    // Drag Right (dxScreen > 0) => Move along positive cameraRight
    const worldMoveX = cameraRight.clone().multiplyScalar(dxScreen * MOVE_SENSITIVITY);

    // Drag Down (dyScreen > 0) => Move along positive cameraForward (CLOSER)
    // Drag Up   (dyScreen < 0) => Move along negative cameraForward (AWAY)
    // To make Drag Up move AWAY (negative cameraForward) and Drag Down move CLOSER (positive cameraForward),
    // we need dyScreen to contribute POSITIVELY to cameraForward when dragging DOWN,
    // and NEGATIVELY when dragging UP.
    // So, if dyScreen is positive (drag down), movement is along +cameraForward.
    // If dyScreen is negative (drag up), movement is along -cameraForward.
    // This means `dyScreen` is used directly.
    // HOWEVER, if you want "Drag UP on screen -> Object moves AWAY" (which is intuitive),
    // and "Drag DOWN on screen -> Object moves CLOSER", then:
    // - Drag UP means dyScreen is NEGATIVE. To move AWAY (along negative cameraForward), we need a POSITIVE factor for -cameraForward.
    //   Or, a NEGATIVE factor for +cameraForward. So, `dyScreen` as is.
    // - Let's re-state: desired UP drag (-dyScreen) -> AWAY (movement in -cameraForward direction)
    //   desired DOWN drag (+dyScreen) -> CLOSER (movement in +cameraForward direction)
    //   This means the scaling factor for `cameraForward` should be `dyScreen`.
    //   If it feels inverted (up moves closer), then use `-dyScreen`.

    const worldMoveZ = cameraForward.clone().multiplyScalar(dyScreen * MOVE_SENSITIVITY);
    // Test: if Z is still inverted (e.g. drag up moves closer), use:
    // const worldMoveZ = cameraForward.clone().multiplyScalar(-dyScreen * MOVE_SENSITIVITY);


    // Combine movements
    lastPlacedObject.position.add(worldMoveX);
    lastPlacedObject.position.add(worldMoveZ);

    initialTouchPosition.copy(currentTouch);
  }
}

function onTouchEnd(event) {
  if (threeFingerMoving && event.touches.length < 3) threeFingerMoving = false;
  if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
    if (lastPlacedObject) {
      currentScale = lastPlacedObject.scale.x;
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