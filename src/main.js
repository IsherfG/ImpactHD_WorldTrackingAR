import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import "./qr.js";
import "./style.css";

let container;
let camera, scene, renderer;
let controller;

let reticle;
let flowersGltf, treesGltf; // Separate GLTF variables for each model

let hitTestSource = null;
let hitTestSourceRequested = false;
let planeFound = false;

let currentScale = 1; // Default scale value
let lastPlacedObject = null; // Variable to store the last placed object

let selectedObject = "flower"; // Default selected object

// Variables for tracking pinch gestures
let initialPinchDistance = null;
let pinchScaling = false;

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

  // Event listeners for object selection buttons
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
        mesh.rotateY(Math.random() * Math.PI * 2);
        scene.add(mesh);

        lastPlacedObject = mesh;

        // Temporary scaling and rotation effect
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
  controller.addEventListener("select", onSelect);
  scene.add(controller);

  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
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
  treeLoader.load("Lu.glb", (gltf) => {
    treesGltf = gltf.scene;
  });

  window.addEventListener("resize", onWindowResize);

  // Add touch event listeners for pinch gesture scaling
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

// Touch events for pinch-to-scale
function onTouchStart(event) {
  if (event.touches.length === 2) {
    pinchScaling = true;
    initialPinchDistance = getPinchDistance(event.touches);
  }
}

function onTouchMove(event) {
  if (pinchScaling && event.touches.length === 2 && lastPlacedObject) {
    const newPinchDistance = getPinchDistance(event.touches);
    const scaleChange = newPinchDistance / initialPinchDistance;

    // Scale the last placed object
    lastPlacedObject.scale.set(
      currentScale * scaleChange,
      currentScale * scaleChange,
      currentScale * scaleChange
    );
  }
}

function onTouchEnd(event) {
  if (event.touches.length < 2) {
    pinchScaling = false;
    if (lastPlacedObject) {
      // Update currentScale to the new scale for continuity
      currentScale = lastPlacedObject.scale.x;
    }
  }
}

function getPinchDistance(touches) {
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
}