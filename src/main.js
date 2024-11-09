import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import "./qr.js";
import "./style.css";

let container;
let camera, scene, renderer;
let controller;

let reticle;
let flowersGltf, treesGltf;

let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

let currentScale = 1;
let lastPlacedObject = null;

let selectedObject = "flower";

// Variables for tracking pinch gestures
let initialPinchDistance = null;
let pinchScaling = false;

// Variables for tracking pinch rotation
let initialPinchAngle = null;
let pinchRotating = false;

// Variables for tracking single-finger move
let moving = false;
let initialTouchPosition = null;

// Variables for tracking three-finger Z-axis move
let threeFingerMoving = false;
let initialZPosition = null;
let initialThreeFingerY = null;

// Check for WebXR session support
if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    if (supported) {
      document.getElementById("ar-not-supported").style.display = "none";
      init();
      animate();
    }
  });
}

function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "block";
}

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );

  const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
  light.position.set(0.5, 1, 0.25);
  scene.add(light);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  container.appendChild(renderer.domElement);

  renderer.xr.addEventListener("sessionstart", sessionStart);

  document.body.appendChild(
    ARButton.createButton(renderer, {
      requiredFeatures: ["local", "hit-test", "dom-overlay"],
      domOverlay: { root: document.querySelector("#overlay") },
    })
  );

  document.getElementById("place-object-btn").addEventListener("click", onSelect);

  document.getElementById("select-flower").addEventListener("click", () => {
    event.stopPropagation();
    selectedObject = "flower";
  });
  document.getElementById("select-tree").addEventListener("click", () => {
    event.stopPropagation();
    selectedObject = "tree";
  });

  function onSelect() {
    if (reticle.visible) {
      let mesh;
      if (selectedObject === "flower" && flowersGltf) {
        const flower = flowersGltf.children[
          Math.floor(Math.random() * flowersGltf.children.length)
        ];
        mesh = flower.clone();
      } else if (selectedObject === "tree" && treesGltf) {
        const tree = treesGltf.children[
          Math.floor(Math.random() * treesGltf.children.length)
        ];
        mesh = tree.clone();
      }

      if (mesh) {
        mesh.scale.set(currentScale, currentScale, currentScale);
        reticle.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);

        const cameraForward = new THREE.Vector3();
        camera.getWorldDirection(cameraForward);
        mesh.lookAt(mesh.position.clone().add(cameraForward));
        mesh.rotateY(Math.random() * Math.PI * 2);
        scene.add(mesh);

        lastPlacedObject = mesh;

        const interval = setInterval(() => {
          mesh.scale.multiplyScalar(1.01);
          mesh.rotateY(0.03);
        }, 16);
        setTimeout(() => {
          clearInterval(interval);
        }, 500);
      }
    }
  }

  controller = renderer.xr.getController(0);
  scene.add(controller);

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.075, 0.1, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial()
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  const loader = new GLTFLoader();
  loader.load("flowers.glb", (gltf) => {
    flowersGltf = gltf.scene;
  });

  const treeLoader = new GLTFLoader();
  treeLoader.load("Shelf.glb", (gltf) => {
    treesGltf = gltf.scene;
  });

  window.addEventListener("resize", onWindowResize);

  window.addEventListener("touchstart", onTouchStart, false);
  window.addEventListener("touchmove", onTouchMove, false);
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

    if (hitTestSourceRequested === false) {
      session.requestReferenceSpace("viewer").then(function (referenceSpace) {
        session
          .requestHitTestSource({ space: referenceSpace })
          .then(function (source) {
            hitTestSource = source;
          });
      });

      session.addEventListener("end", function () {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });

      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);

      if (hitTestResults.length) {
        if (!planeFound) {
          planeFound = true;
          document.getElementById("tracking-prompt").style.display = "none";
          document.getElementById("instructions").style.display = "flex";
        }
        const hit = hitTestResults[0];

        reticle.visible = true;
        reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  }

  renderer.render(scene, camera);
}

function onTouchStart(event) {
  if (event.touches.length === 3 && lastPlacedObject) {
    threeFingerMoving = true;
    initialZPosition = lastPlacedObject.position.z;
    initialThreeFingerY = event.touches[0].pageY;
  } else if (event.touches.length === 2) {
    pinchScaling = true;
    pinchRotating = true;
    initialPinchDistance = getPinchDistance(event.touches);
    initialPinchAngle = getPinchAngle(event.touches);
  } else if (event.touches.length === 1 && lastPlacedObject) {
    moving = true;
    initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
  }
}

function onTouchMove(event) {
  if (event.touches.length === 3 && threeFingerMoving && lastPlacedObject) {
    // Calculate the change in Y from the initial three-finger touch position
    const deltaY = initialThreeFingerY - event.touches[0].pageY; // Reverse the direction
    // Adjust the Y position of the object (up and down movement) with reduced intensity
    lastPlacedObject.position.y = initialZPosition + deltaY * 0.005; // Reduced multiplier
  } else if (event.touches.length === 2 && lastPlacedObject) {
    const newPinchDistance = getPinchDistance(event.touches);
    const newPinchAngle = getPinchAngle(event.touches);

    if (pinchScaling) {
      const scaleChange = newPinchDistance / initialPinchDistance;
      lastPlacedObject.scale.set(
        currentScale * scaleChange,
        currentScale * scaleChange,
        currentScale * scaleChange
      );
    }

    if (pinchRotating) {
      const angleChange = newPinchAngle - initialPinchAngle;
      lastPlacedObject.rotation.y += angleChange;
      initialPinchAngle = newPinchAngle;
    }
  } else if (event.touches.length === 1 && moving && lastPlacedObject) {
    const currentTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
    const deltaX = (currentTouchPosition.x - initialTouchPosition.x) / window.innerWidth;
    const deltaY = (currentTouchPosition.y - initialTouchPosition.y) / window.innerHeight;

    const moveDirection = new THREE.Vector3(deltaX, 0, deltaY).applyQuaternion(camera.quaternion);
    lastPlacedObject.position.add(moveDirection);

    initialTouchPosition.copy(currentTouchPosition);
  }
}

function onTouchEnd(event) {
  if (event.touches.length < 3) {
    threeFingerMoving = false;
  }
  if (event.touches.length < 2) {
    pinchScaling = false;
    pinchRotating = false;
    moving = false;
    if (lastPlacedObject) {
      currentScale = lastPlacedObject.scale.x;
    }
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