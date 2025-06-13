import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Pane } from 'tweakpane';

// App state
let scene, camera, renderer, orbitControls, transformControls;
let selectedObject = null;
let currentMode = 'OBJECT'; // 'OBJECT' or 'EDIT'
let vertexHelpers = null;
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const sceneObjects = [];

// DOM Elements
const viewportContainer = document.getElementById('viewport-container');
const outlinerList = document.getElementById('outliner-list');
const propertiesPanelContainer = document.getElementById('properties-panel-container');
const modeSelect = document.getElementById('mode-select');

// Properties Pane
let pane;
let refreshPane = () => {};

function init() {
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(viewportContainer.clientWidth, viewportContainer.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    viewportContainer.appendChild(renderer.domElement);

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x383838);

    // Camera
    camera = new THREE.PerspectiveCamera(50, viewportContainer.clientWidth / viewportContainer.clientHeight, 0.1, 1000);
    camera.position.set(4, 5, 7);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(5, 10, 7.5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);
    
    // Grid Helper
    const gridHelper = new THREE.GridHelper(10, 10, 0x888888, 0x444444);
    scene.add(gridHelper);

    // Controls
    orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.05;

    transformControls = new TransformControls(camera, renderer.domElement);
    scene.add(transformControls);

    // Initial Object
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x3d8bfd, metalness: 0.1, roughness: 0.4 });
    const cube = new THREE.Mesh(geometry, material);
    cube.castShadow = true;
    cube.receiveShadow = true;
    cube.name = "Cube";
    scene.add(cube);
    sceneObjects.push(cube);

    updateOutliner();
    addEventListeners();
    animate();
}

function updateOutliner() {
    outlinerList.innerHTML = '';
    sceneObjects.forEach(obj => {
        const li = document.createElement('li');
        li.textContent = obj.name;
        li.dataset.uuid = obj.uuid;
        if (selectedObject && obj.uuid === selectedObject.uuid) {
            li.classList.add('selected');
        }
        li.addEventListener('click', () => {
            selectObject(obj);
        });
        outlinerList.appendChild(li);
    });
}

function selectObject(object) {
    if (selectedObject === object) return;
    
    // If we are in edit mode when selecting a new object, switch to object mode first
    if (currentMode === 'EDIT') {
        setMode('OBJECT');
    }

    selectedObject = object;
    transformControls.attach(object);
    setupTweakpaneForObject(object);
    updateOutliner();

    modeSelect.options[1].disabled = false;
}

function deselectObject() {
    if (!selectedObject) return;

    if (currentMode === 'EDIT') {
        setMode('OBJECT');
    }
    
    selectedObject = null;
    transformControls.detach();
    if (pane) pane.dispose();
    pane = null;
    refreshPane = () => {};
    updateOutliner();

    modeSelect.value = 'OBJECT';
    modeSelect.options[1].disabled = true;
}

function setupTweakpaneForObject(object) {
    if (pane) pane.dispose();

    pane = new Pane({
        container: propertiesPanelContainer,
        title: object.name + ' Properties',
    });
    
    const transformFolder = pane.addFolder({ title: 'Transform' });
    // Position
    transformFolder.addBinding(object.position, 'x', { min: -10, max: 10, step: 0.01 });
    transformFolder.addBinding(object.position, 'y', { min: -10, max: 10, step: 0.01 });
    transformFolder.addBinding(object.position, 'z', { min: -10, max: 10, step: 0.01 });

    // Rotation (in degrees)
    const euler = new THREE.Euler().setFromQuaternion(object.quaternion, 'YXZ');
    const rotationProxy = {
        x: THREE.MathUtils.radToDeg(euler.x),
        y: THREE.MathUtils.radToDeg(euler.y),
        z: THREE.MathUtils.radToDeg(euler.z),
    };
    const rotChange = () => {
        euler.set(
            THREE.MathUtils.degToRad(rotationProxy.x),
            THREE.MathUtils.degToRad(rotationProxy.y),
            THREE.MathUtils.degToRad(rotationProxy.z),
            'YXZ'
        );
        object.quaternion.setFromEuler(euler);
    };
    transformFolder.addBinding(rotationProxy, 'x', { label: 'rotX', min: -180, max: 180, step: 1 }).on('change', rotChange);
    transformFolder.addBinding(rotationProxy, 'y', { label: 'rotY', min: -180, max: 180, step: 1 }).on('change', rotChange);
    transformFolder.addBinding(rotationProxy, 'z', { label: 'rotZ', min: -180, max: 180, step: 1 }).on('change', rotChange);
    
    // Scale
    transformFolder.addBinding(object.scale, 'x', { label: 'scaleX', min: 0.1, max: 5, step: 0.01 });
    transformFolder.addBinding(object.scale, 'y', { label: 'scaleY', min: 0.1, max: 5, step: 0.01 });
    transformFolder.addBinding(object.scale, 'z', { label: 'scaleZ', min: 0.1, max: 5, step: 0.01 });
    
    // Material
    const matFolder = pane.addFolder({ title: 'Material' });
    matFolder.addBinding(object.material, 'color', { view: 'color' });
    matFolder.addBinding(object.material, 'metalness', { min: 0, max: 1 });
    matFolder.addBinding(object.material, 'roughness', { min: 0, max: 1 });
    matFolder.addBinding(object.material, 'wireframe');
    
    pane.element.style.display = 'block';

    refreshPane = () => {
        if (!pane || !object) return;
        euler.setFromQuaternion(object.quaternion, 'YXZ');
        rotationProxy.x = THREE.MathUtils.radToDeg(euler.x);
        rotationProxy.y = THREE.MathUtils.radToDeg(euler.y);
        rotationProxy.z = THREE.MathUtils.radToDeg(euler.z);
        pane.refresh();
    };
}

function addEventListeners() {
    window.addEventListener('resize', onWindowResize);

    transformControls.addEventListener('dragging-changed', event => {
        orbitControls.enabled = !event.value;
    });
    
    transformControls.addEventListener('objectChange', () => {
        refreshPane();
    });

    window.addEventListener('keydown', event => {
        const activeEl = document.activeElement;
        // Ignore key events if an input is focused
        if (activeEl && (activeEl.tagName.toLowerCase() === 'input' || activeEl.tagName.toLowerCase() === 'select' || activeEl.tagName.toLowerCase() === 'textarea')) {
            return;
        }

        switch (event.key.toLowerCase()) {
            case 't': if (currentMode === 'OBJECT') transformControls.setMode('translate'); break;
            case 'r': if (currentMode === 'OBJECT') transformControls.setMode('rotate'); break;
            case 's': if (currentMode === 'OBJECT') transformControls.setMode('scale'); break;
            case 'escape': deselectObject(); break;
            case 'tab':
                event.preventDefault(); // Prevent focus change
                if(selectedObject){
                    const newMode = currentMode === 'OBJECT' ? 'EDIT' : 'OBJECT';
                    setMode(newMode);
                }
                break;
        }
    });
    
    viewportContainer.addEventListener('pointerdown', onPointerDown);

    modeSelect.addEventListener('change', (e) => {
        if (selectedObject) {
            setMode(e.target.value);
        }
    });
}

function onWindowResize() {
    camera.aspect = viewportContainer.clientWidth / viewportContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewportContainer.clientWidth, viewportContainer.clientHeight);
}

function onPointerDown(event) {
    if (transformControls.dragging || event.button !== 0) return;

    if (currentMode === 'EDIT') {
        // In Edit Mode, clicking doesn't select objects.
        // Vertex selection logic will go here in the future.
        return;
    }
    
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(sceneObjects, false);

    if (intersects.length > 0) {
        // Prevent click-through when clicking gizmo handle
        if(intersects[0].object !== selectedObject) {
            selectObject(intersects[0].object);
        }
    } else {
        if (event.target === renderer.domElement) {
             deselectObject();
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    orbitControls.update();
    renderer.render(scene, camera);
}

function setMode(newMode) {
    if (currentMode === newMode || !selectedObject) return;

    currentMode = newMode;
    modeSelect.value = newMode;

    if (newMode === 'EDIT') {
        // --- Enter Edit Mode ---
        transformControls.detach();
        if(pane) pane.element.style.display = 'none';

        // Store original material state and apply edit mode look
        if (!selectedObject.userData.originalMaterialProps) {
             selectedObject.userData.originalMaterialProps = {
                wireframe: selectedObject.material.wireframe || false
            };
        }
        selectedObject.material.wireframe = true;

        // Create vertex helpers
        const pointsMaterial = new THREE.PointsMaterial({
            color: 0xffff00,
            size: 8,
            sizeAttenuation: false, // size in pixels
            depthTest: false, // always visible
        });
        vertexHelpers = new THREE.Points(selectedObject.geometry, pointsMaterial);
        vertexHelpers.name = "VertexHelpers";
        vertexHelpers.renderOrder = 1; // render on top of mesh
        selectedObject.add(vertexHelpers);

    } else { // --- Enter Object Mode ---
        if(pane) pane.element.style.display = 'block';
        
        if (vertexHelpers && selectedObject) {
            selectedObject.remove(vertexHelpers);
            vertexHelpers.material.dispose();
            // We don't dispose geometry because it's shared with the mesh
            vertexHelpers = null;

            // Restore material
            if(selectedObject.userData.originalMaterialProps) {
                selectedObject.material.wireframe = selectedObject.userData.originalMaterialProps.wireframe;
            }
        }

        if (selectedObject) {
            transformControls.attach(selectedObject);
        }
    }
}

init();
document.body.focus();