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
let currentGlobalScale = DEFAULT_OBJECT_SCALE; // Scale for NEWLY placed objects
let selectedForManipulation = null; // The currently selected object
let allPlacedObjects = []; // Array to store all placed objects

// Raycasting for selection
const raycaster = new THREE.Raycaster();
const tapPosition = new THREE.Vector2();
const originalMaterials = new Map(); // To store original materials for deselection highlight

let selectedObjectUI = "obj1"; // ID of the object type selected in the UI palette

// Touch gesture variables
let initialPinchDistance = null;
let pinchScaling = false;
let scaleAtPinchStart = 1.0; // Temp variable to store selected object's scale at pinch start
let initialPinchAngle = null;
let pinchRotating = false;
let moving = false;
let initialTouchPosition = null;
const MOVE_SENSITIVITY = 0.002;
let threeFingerMoving = false;
let initialZPosition = null; // Object's Y position for 3-finger move
let initialThreeFingerY = null; // Touch Y screen position for 3-finger move

const HDR_ENVIRONMENT_MAP_PATH = 'hdr.hdr';

function updateSelectedObjectUIButton(selectedId) {
    document.querySelectorAll('.object-btn').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.objectId === selectedId) {
            btn.classList.add('selected');
        }
    });
}

if ("xr" in navigator) {
  navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
    if (supported) {
      document.getElementById("ar-not-supported").style.display = "none";
      init();
      animate();
    } else { /* ... AR not supported ... */ }
  }).catch((err) => { /* ... error ... */ });
} else { /* ... WebXR not found ... */ }

function sessionStart() {
  planeFound = false;
  document.getElementById("tracking-prompt").style.display = "flex";
  document.getElementById("bottom-controls").style.display = "none";
  document.getElementById("delete-object-btn").style.display = "none";
  // Deselect and remove all objects if session restarts
  deselectObject();
  allPlacedObjects.forEach(obj => scene.remove(obj));
  allPlacedObjects = [];
}

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

  // Lighting (Hemisphere, Ambient, Directional with shadows)
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 0.6); scene.add(hemiLight);
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(1.5, 2, 1).normalize(); directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.set(1024, 1024); directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 10; directionalLight.shadow.bias = -0.001;
  Object.assign(directionalLight.shadow.camera, {left: -2, right: 2, top: 2, bottom: -2});
  scene.add(directionalLight);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  Object.assign(renderer, {outputEncoding: THREE.sRGBEncoding, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0});
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.xr.addEventListener("sessionstart", sessionStart);

  new RGBELoader().load(HDR_ENVIRONMENT_MAP_PATH, tex => {
    tex.mapping = THREE.EquirectangularReflectionMapping; scene.environment = tex;
    console.log("Env map loaded.");
  }, undefined, err => console.error("HDR load error:", err));

  const arButton = ARButton.createButton(renderer, { requiredFeatures: ["local", "hit-test", "dom-overlay"], domOverlay: { root: document.querySelector("#overlay") }});
  document.body.appendChild(arButton);

  document.getElementById("place-object-btn").addEventListener("click", placeNewObject);
  document.getElementById("delete-object-btn").addEventListener("click", () => {
    if (selectedForManipulation) {
      scene.remove(selectedForManipulation);
      selectedForManipulation.traverse(c => { if(c.isMesh){if(c.geometry)c.geometry.dispose(); if(c.material){ if(Array.isArray(c.material))c.material.forEach(m=>{if(m.map)m.map.dispose();m.dispose();}); else{if(c.material.map)c.material.map.dispose();c.material.dispose();}}}});
      allPlacedObjects = allPlacedObjects.filter(obj => obj !== selectedForManipulation);
      deselectObject(); // This also hides delete button
    }
  });

  document.querySelectorAll('.object-btn').forEach(button => {
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        selectedObjectUI = button.dataset.objectId;
        updateSelectedObjectUIButton(selectedObjectUI);
    });
  });
  const firstObjectButton = document.querySelector('.object-btn');
  if (firstObjectButton) { selectedObjectUI = firstObjectButton.dataset.objectId; updateSelectedObjectUIButton(selectedObjectUI); }

  reticle = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.1, 24).rotateX(-Math.PI/2), new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.6,side:THREE.DoubleSide}));
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

  // GLTF Loading
  const gltfLoader = new GLTFLoader(); const textureLoader = new THREE.TextureLoader();
  const loadErrCb = name => err => console.error(`Err loading ${name}:`, err);
  const applyTex = (gltfScn, tex) => {gltfScn.traverse(n=>{if(n.isMesh){let nM;if(n.material?.isMeshStandardMaterial)nM=n.material.clone();else{nM=new THREE.MeshStandardMaterial();if(n.material?.color)nM.color.copy(n.material.color);}nM.map=tex;nM.needsUpdate=true;n.material=nM;}});};
  gltfLoader.load("Shelf.glb",gltf=>{object1=gltf.scene;},undefined,loadErrCb("Shelf.glb"));
  textureLoader.load("Shelf.png",t=>{t.flipY=false;t.encoding=THREE.sRGBEncoding;gltfLoader.load("Shelf2.glb",g=>{object2=g.scene;applyTex(object2,t);},undefined,loadErrCb("Shelf2.glb"));},undefined,loadErrCb("Shelf.png"));
  textureLoader.load("Map1.png",t=>{t.flipY=false;t.encoding=THREE.sRGBEncoding;gltfLoader.load("Bag1.glb",g=>{object3=g.scene;applyTex(object3,t);},undefined,loadErrCb("Bag1.glb"));},undefined,loadErrCb("Map1.png"));
  textureLoader.load("Map2.jpg",t=>{t.flipY=false;t.encoding=THREE.sRGBEncoding;gltfLoader.load("Bag2.glb",g=>{object4=g.scene;applyTex(object4,t);},undefined,loadErrCb("Bag2.glb"));},undefined,loadErrCb("Map2.jpg"));
  textureLoader.load("Map3.png",t=>{t.flipY=false;t.encoding=THREE.sRGBEncoding;gltfLoader.load("Bag3.glb",g=>{object5=g.scene;applyTex(object5,t);},undefined,loadErrCb("Bag3.glb"));},undefined,loadErrCb("Map3.png"));

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd, false);
}

function placeNewObject() {
  if (reticle.visible) {
    let modelToClone;
    if (selectedObjectUI === "obj1" && object1) modelToClone = object1;
    else if (selectedObjectUI === "obj2" && object2) modelToClone = object2;
    else if (selectedObjectUI === "obj3" && object3) modelToClone = object3;
    else if (selectedObjectUI === "obj4" && object4) modelToClone = object4;
    else if (selectedObjectUI === "obj5" && object5) modelToClone = object5;

    if (modelToClone) {
      const mesh = modelToClone.clone();
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }});

      const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
      reticle.matrix.decompose(pos, quat, new THREE.Vector3());
      mesh.position.copy(pos); mesh.quaternion.copy(quat);
      mesh.scale.setScalar(currentGlobalScale); // Use global scale for new objects

      const camLook = new THREE.Vector3(); camera.getWorldPosition(camLook);
      mesh.lookAt(camLook.x, mesh.position.y, camLook.z);

      scene.add(mesh);
      allPlacedObjects.push(mesh);
      selectObject(mesh); // Auto-select newly placed object

      const targetScale = mesh.scale.x; mesh.scale.setScalar(targetScale * 0.1);
      const t0 = performance.now();
      function anim() { if (!mesh.parent) return; const t = performance.now()-t0; if (t>=300) {mesh.scale.setScalar(targetScale);return;} const p=1-Math.pow(1-(t/300),3); mesh.scale.setScalar(targetScale*0.1+targetScale*0.9*p); requestAnimationFrame(anim); }
      requestAnimationFrame(anim);
    }
  }
}

function selectObject(object) {
    if (selectedForManipulation === object && object !== null) return; // Avoid re-selecting if already selected (unless null)
    deselectObject();
    if (!object) return; // If called with null, just deselect

    selectedForManipulation = object;
    document.getElementById("delete-object-btn").style.display = "flex";
    object.traverse(c => { if(c.isMesh&&c.material){ if(!originalMaterials.has(c.uuid)) originalMaterials.set(c.uuid,{e:c.material.emissive?c.material.emissive.clone():new THREE.Color(0),ei:c.material.emissiveIntensity||0}); if(c.material.isMeshStandardMaterial||c.material.isMeshPhongMaterial){c.material.emissive=new THREE.Color(0x00cc00);c.material.emissiveIntensity=0.7;if(c.material.needsUpdate!==undefined)c.material.needsUpdate=true;}}});
}

function deselectObject() {
    if (selectedForManipulation) {
        selectedForManipulation.traverse(c => { if(c.isMesh&&originalMaterials.has(c.uuid)){const oP=originalMaterials.get(c.uuid);if(c.material.isMeshStandardMaterial||c.material.isMeshPhongMaterial){c.material.emissive=oP.e;c.material.emissiveIntensity=oP.ei;if(c.material.needsUpdate!==undefined)c.material.needsUpdate=true;}originalMaterials.delete(c.uuid);}});
    }
    selectedForManipulation = null;
    document.getElementById("delete-object-btn").style.display = "none";
}

function handleObjectTapSelection(event) {
    if (!event.touches || event.touches.length === 0) return; // Should have a touch
    const touch = event.touches[0];
    tapPosition.x = (touch.clientX / window.innerWidth) * 2 - 1;
    tapPosition.y = -(touch.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(tapPosition, camera);
    const intersects = raycaster.intersectObjects(allPlacedObjects, true);

    if (intersects.length > 0) {
        let closestRootObject = null;
        for (const intersect of intersects) {
            let obj = intersect.object;
            while(obj.parent && obj.parent !== scene) obj = obj.parent;
            if (allPlacedObjects.includes(obj)) { closestRootObject = obj; break; }
        }
        if (closestRootObject) selectObject(closestRootObject);
        else deselectObject(); // Tapped something, but not one of our root objects
    } else {
        deselectObject(); // Tapped empty space
    }
}

function onWindowResize() { /* ... camera & renderer resize ... */ }
function animate() { renderer.setAnimationLoop(render); }

function render(timestamp, frame) {
  if (frame) {
    const referenceSpace = renderer.xr.getReferenceSpace(); const session = renderer.xr.getSession();
    if (!hitTestSourceRequested && session) {
      session.requestReferenceSpace("viewer").then(ref=>session.requestHitTestSource({space:ref}).then(src=>{hitTestSource=src;}).catch(e=>console.error("HtsErr:",e))).catch(e=>console.error("VrsErr:",e));
      session.addEventListener("end",()=>{hitTestSourceRequested=false;hitTestSource=null;planeFound=false;document.getElementById("tracking-prompt").style.display="none";document.getElementById("bottom-controls").style.display="none";deselectObject();allPlacedObjects.forEach(o=>scene.remove(o));allPlacedObjects=[];currentGlobalScale=DEFAULT_OBJECT_SCALE;});
      hitTestSourceRequested = true;
    }
    if (hitTestSource && referenceSpace) {
      const results = frame.getHitTestResults(hitTestSource);
      if (results.length) {
        if (!planeFound) { planeFound=true;document.getElementById("tracking-prompt").style.display="none";document.getElementById("bottom-controls").style.display="flex";}
        const pose = results[0].getPose(referenceSpace);
        if(pose){reticle.visible=true;reticle.matrix.fromArray(pose.transform.matrix);}else{reticle.visible=false;}
      } else { reticle.visible = false; }
    }
  }
  renderer.render(scene, camera);
}

function onTouchStart(event) {
    let targetEl = event.target; let isUITouch = false;
    while(targetEl && targetEl !== document.body){if(targetEl.dataset?.ignoreTap==='true'||targetEl.closest('#object-selector')||targetEl.closest('#action-buttons')){isUITouch=true;break;}targetEl=targetEl.parentElement;}
    if(isUITouch){moving=pinchScaling=pinchRotating=threeFingerMoving=false; return;}

    if (event.touches.length === 3 && selectedForManipulation) {
        threeFingerMoving=true; initialZPosition=selectedForManipulation.position.y; initialThreeFingerY=event.touches[0].pageY;
        pinchScaling=pinchRotating=moving=false;
    } else if (event.touches.length === 2 && selectedForManipulation) {
        pinchScaling=true; pinchRotating=true; initialPinchDistance=getPinchDistance(event.touches); initialPinchAngle=getPinchAngle(event.touches);
        scaleAtPinchStart = selectedForManipulation.scale.x; // Capture current scale of this object for this pinch
        moving=threeFingerMoving=false;
    } else if (event.touches.length === 1) {
        // Handle single tap for selection OR starting a move on an ALREADY selected object
        const justTappedToSelect = !selectedForManipulation; // True if nothing was selected before this tap
        handleObjectTapSelection(event); // This might change selectedForManipulation

        // If an object is selected (either newly or was already), a single touch can start a move
        if (selectedForManipulation) {
            // If we *just* selected an object with this tap, don't immediately start moving it.
            // Require a new touch down to start moving. Or, allow move if it was already selected.
            // Current logic: if selection changed by this tap, moving will be false for this gesture.
            // If tap did NOT change selection (tapped selected obj again, or empty space and obj remains selected), allow move.
            if (justTappedToSelect && selectedForManipulation === event.target) { // crude check if tap was on the obj itself
                 moving = false; // Don't start move on the same tap that selected it
            } else if (selectedForManipulation) { // If it was already selected or tap was on empty space
                 moving = true;
            }
            initialTouchPosition = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
        } else {
            moving = false; // Nothing selected, so no move
        }
        pinchScaling=pinchRotating=threeFingerMoving=false; // Reset other gestures
    }
}

function onTouchMove(event) {
    if (!selectedForManipulation) return; // No gestures if nothing is selected

    if (threeFingerMoving && event.touches.length === 3) {
        selectedForManipulation.position.y = initialZPosition + ((initialThreeFingerY - event.touches[0].pageY) * 0.005);
    } else if (pinchScaling && event.touches.length === 2) {
        const newDist = getPinchDistance(event.touches);
        const newScale = scaleAtPinchStart * (newDist / initialPinchDistance);
        selectedForManipulation.scale.setScalar(newScale);
        if (pinchRotating) {
            const newAngle = getPinchAngle(event.touches);
            selectedForManipulation.rotation.y += (newAngle - initialPinchAngle);
            initialPinchAngle = newAngle;
        }
    } else if (moving && event.touches.length === 1) {
        const touch = new THREE.Vector2(event.touches[0].pageX, event.touches[0].pageY);
        const dx = touch.x - initialTouchPosition.x; const dy = touch.y - initialTouchPosition.y;
        const camR = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0); camR.y=0; camR.normalize();
        const camF = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,2); camF.negate(); camF.y=0; camF.normalize();
        const mvX = camR.multiplyScalar(dx*MOVE_SENSITIVITY); const mvZ = camF.multiplyScalar(-dy*MOVE_SENSITIVITY);
        selectedForManipulation.position.add(mvX).add(mvZ);
        initialTouchPosition.copy(touch);
    }
}

function onTouchEnd(event) {
    if (threeFingerMoving && event.touches.length < 3) threeFingerMoving = false;
    if ((pinchScaling || pinchRotating) && event.touches.length < 2) {
        if (selectedForManipulation) {
            currentGlobalScale = selectedForManipulation.scale.x; // Update global scale for next new object
        }
        pinchScaling = false; pinchRotating = false;
    }
    // If it was a move gesture and the last finger is up.
    // A single tap for selection should not set moving to true *then* false immediately.
    // The 'moving' flag is now set more carefully in onTouchStart.
    if (moving && event.touches.length < 1) moving = false;

    if (event.touches.length === 0) { // Reset all flags
        threeFingerMoving = pinchScaling = pinchRotating = moving = false;
    }
}

function getPinchDistance(touches) { /* ... dx, dy, sqrt ... */ return Math.hypot(touches[0].pageX-touches[1].pageX, touches[0].pageY-touches[1].pageY); }
function getPinchAngle(touches) { /* ... dx, dy, atan2 ... */ return Math.atan2(touches[0].pageY-touches[1].pageY, touches[0].pageX-touches[1].pageX); }