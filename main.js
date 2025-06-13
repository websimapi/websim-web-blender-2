import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { Pane } from 'tweakpane';

// App state
let scene, camera, renderer, orbitControls, transformControls;
let selectedObject = null;
let currentMode = 'OBJECT'; // 'OBJECT' or 'EDIT'
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const sceneObjects = [];

// Edit mode state
let editSelectionMode = 'VERTEX'; // 'VERTEX', 'EDGE', 'FACE'
let vertexHelpers, faceHighlightHelper, selectedEdgeHelper;
let editModeProxy;
let isDraggingInEditMode = false;
const dragStartProxyPosition = new THREE.Vector3();
const initialVertexPositions = new Map();
const affectedVertexIndices = new Set();

const selections = {
    vertices: new Set(),
    edges: new Set(), // Storing edge keys 'v1-v2'
    faces: new Set()
};
let allEdges = new Map();

// DOM Elements
const viewportContainer = document.getElementById('viewport-container');
const outlinerList = document.getElementById('outliner-list');
const propertiesPanelContainer = document.getElementById('properties-panel-container');
const modeSelect = document.getElementById('mode-select');
const editModeTools = document.getElementById('edit-mode-tools');
const editToolBtns = {
    vertex: document.getElementById('select-vertex-btn'),
    edge: document.getElementById('select-edge-btn'),
    face: document.getElementById('select-face-btn'),
};

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
    transformControls.setMode('translate');
    scene.add(transformControls);
    
    editModeProxy = new THREE.Object3D();
    editModeProxy.name = 'EditModeProxy';
    scene.add(editModeProxy);

    // Initial Object
    let geometry = new THREE.BoxGeometry(1, 1, 1);
    // Convert to indexed geometry for proper editing
    geometry = BufferGeometryUtils.mergeVertices(geometry);
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
        if (!selectedObject) return;

        if (currentMode === 'EDIT') {
            isDraggingInEditMode = event.value;

            if (isDraggingInEditMode) { // Drag start
                dragStartProxyPosition.copy(editModeProxy.position);
                initialVertexPositions.clear();
                const positions = selectedObject.geometry.attributes.position;
                for (const index of affectedVertexIndices) {
                    const pos = new THREE.Vector3().fromBufferAttribute(positions, index);
                    initialVertexPositions.set(index, pos);
                }
            }
        }
    });
    
    transformControls.addEventListener('objectChange', () => {
        if (currentMode === 'OBJECT' && selectedObject) {
            refreshPane();
        } else if (currentMode === 'EDIT' && isDraggingInEditMode) {
            applyEditModeTransformation();
        }
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
            case '1': if (currentMode === 'EDIT') setEditSelectionMode('VERTEX'); break;
            case '2': if (currentMode === 'EDIT') setEditSelectionMode('EDGE'); break;
            case '3': if (currentMode === 'EDIT') setEditSelectionMode('FACE'); break;
        }
    });
    
    viewportContainer.addEventListener('pointerdown', onPointerDown);

    modeSelect.addEventListener('change', (e) => {
        if (selectedObject) {
            setMode(e.target.value);
        }
    });

    editToolBtns.vertex.addEventListener('click', () => setEditSelectionMode('VERTEX'));
    editToolBtns.edge.addEventListener('click', () => setEditSelectionMode('EDGE'));
    editToolBtns.face.addEventListener('click', () => setEditSelectionMode('FACE'));
}

function onWindowResize() {
    camera.aspect = viewportContainer.clientWidth / viewportContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(viewportContainer.clientWidth, viewportContainer.clientHeight);
}

function onPointerDown(event) {
    if (transformControls.dragging || event.button !== 0) return;

    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    if (currentMode === 'EDIT') {
        handleEditModeClick(event.shiftKey);
        return;
    }
    
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

function setEditSelectionMode(mode) {
    if (editSelectionMode === mode) return;
    editSelectionMode = mode;

    // Clear selections when changing mode
    clearAllSelections();

    // Update button styles
    Object.values(editToolBtns).forEach(btn => btn.classList.remove('active'));
    if (mode === 'VERTEX') editToolBtns.vertex.classList.add('active');
    if (mode === 'EDGE') editToolBtns.edge.classList.add('active');
    if (mode === 'FACE') editToolBtns.face.classList.add('active');
}

function clearAllSelections() {
    selections.vertices.clear();
    selections.edges.clear();
    selections.faces.clear();
    updateVertexSelectionVisuals();
    updateEdgeSelectionVisuals();
    updateFaceSelectionVisuals();
    updateEditModeProxy();
}

function setMode(newMode) {
    if (currentMode === newMode || !selectedObject) return;

    currentMode = newMode;
    modeSelect.value = newMode;

    if (newMode === 'EDIT') {
        // --- Enter Edit Mode ---
        editModeTools.style.display = 'flex';
        setEditSelectionMode('VERTEX');
        transformControls.detach();
        transformControls.setMode('translate');
        if(pane) pane.element.style.display = 'none';

        selectedObject.userData.originalWireframe = selectedObject.material.wireframe;
        selectedObject.material.wireframe = true;

        preprocessGeometry(selectedObject.geometry);

        // Create vertex helpers
        const pointsMaterial = new THREE.PointsMaterial({
            size: 10,
            sizeAttenuation: false, // size in pixels
            depthTest: false,
            vertexColors: true,
            transparent: true,
        });
        const helperGeometry = new THREE.BufferGeometry();
        helperGeometry.setAttribute('position', selectedObject.geometry.attributes.position); // Share position buffer
        
        vertexHelpers = new THREE.Points(helperGeometry, pointsMaterial);
        const numVertices = selectedObject.geometry.attributes.position.count;
        const colors = new Float32Array(numVertices * 4); // RGBA
        helperGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
        vertexHelpers.name = "VertexHelpers";
        vertexHelpers.renderOrder = 2; // render on top
        selectedObject.add(vertexHelpers);

        // Create face highlight helper
        const highlightMaterial = new THREE.MeshBasicMaterial({
            color: 0xffa500, side: THREE.DoubleSide, transparent: true, opacity: 0.5, depthTest: false
        });
        faceHighlightHelper = new THREE.Mesh(new THREE.BufferGeometry(), highlightMaterial);
        faceHighlightHelper.renderOrder = 1;
        selectedObject.add(faceHighlightHelper);

        // Create edge highlight helper
        const selectedEdgeMaterial = new THREE.LineBasicMaterial({ color: 0xffa500, linewidth: 4, depthTest: false });
        selectedEdgeHelper = new THREE.LineSegments(new THREE.BufferGeometry(), selectedEdgeMaterial);
        selectedEdgeHelper.renderOrder = 2;
        selectedObject.add(selectedEdgeHelper);

        updateVertexSelectionVisuals();

    } else { // --- Enter Object Mode ---
        editModeTools.style.display = 'none';
        if(pane) pane.element.style.display = 'block';
        
        transformControls.detach(); // Detach from proxy

        if (selectedObject) {
            selectedObject.material.wireframe = selectedObject.userData.originalWireframe;
            if(vertexHelpers) {
                selectedObject.remove(vertexHelpers);
                vertexHelpers.geometry.dispose();
                vertexHelpers.material.dispose();
                vertexHelpers = null;
            }
            if(faceHighlightHelper) {
                selectedObject.remove(faceHighlightHelper);
                faceHighlightHelper.geometry.dispose();
                faceHighlightHelper.material.dispose();
                faceHighlightHelper = null;
            }
             if(selectedEdgeHelper) {
                selectedObject.remove(selectedEdgeHelper);
                selectedEdgeHelper.geometry.dispose();
                selectedEdgeHelper.material.dispose();
                selectedEdgeHelper = null;
            }
        }
        clearAllSelections();

        if (selectedObject) {
            transformControls.attach(selectedObject);
        }
    }
}

// --- EDIT MODE HELPERS ---

function preprocessGeometry(geometry) {
    allEdges.clear();
    const index = geometry.index;
    const vertices = geometry.attributes.position;
    if (!index) return; // Only works for indexed geometry for now

    for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i);
        const b = index.getX(i + 1);
        const c = index.getX(i + 2);

        const edges = [[a, b], [b, c], [c, a]];
        edges.forEach(edge => {
            const key = edge[0] < edge[1] ? `${edge[0]}-${edge[1]}` : `${edge[1]}-${edge[0]}`;
            if (!allEdges.has(key)) {
                allEdges.set(key, edge);
            }
        });
    }
}

function handleEditModeClick(isMultiSelect) {
    let changed = false;
    
    if (editSelectionMode === 'VERTEX') {
        const intersects = raycaster.intersectObject(vertexHelpers, false);
        if (intersects.length > 0) {
            const index = intersects[0].index;
            if (!isMultiSelect) {
                const isAlreadyOnlySelected = selections.vertices.size === 1 && selections.vertices.has(index);
                if (!isAlreadyOnlySelected) {
                    clearAllSelections();
                    selections.vertices.add(index);
                }
            } else {
                if (selections.vertices.has(index)) {
                    selections.vertices.delete(index);
                } else {
                    selections.vertices.add(index);
                }
            }
            changed = true;
        }
    } else if (editSelectionMode === 'FACE') {
        const intersects = raycaster.intersectObject(selectedObject, false);
        if (intersects.length > 0) {
            const faceIndex = intersects[0].faceIndex;
            if (!isMultiSelect) {
                const isAlreadyOnlySelected = selections.faces.size === 1 && selections.faces.has(faceIndex);
                if (!isAlreadyOnlySelected) {
                    clearAllSelections();
                    selections.faces.add(faceIndex);
                }
            } else {
                if (selections.faces.has(faceIndex)) {
                    selections.faces.delete(faceIndex);
                } else {
                    selections.faces.add(faceIndex);
                }
            }
            changed = true;
        }
    } else if (editSelectionMode === 'EDGE') {
        const intersects = raycaster.intersectObject(selectedObject, false);
        if (intersects.length > 0) {
            const intersect = intersects[0];
            const key = getClosestEdgeToPoint(intersect.face, intersect.point, selectedObject.geometry);
            if (!isMultiSelect) {
                const isAlreadyOnlySelected = selections.edges.size === 1 && selections.edges.has(key);
                if (!isAlreadyOnlySelected) {
                    clearAllSelections();
                    selections.edges.add(key);
                }
            } else {
                if (selections.edges.has(key)) {
                    selections.edges.delete(key);
                } else {
                    selections.edges.add(key);
                }
            }
            changed = true;
        }
    }

    if (!changed && !isMultiSelect) {
        clearAllSelections();
    } else if (changed) {
        updateVertexSelectionVisuals();
        updateEdgeSelectionVisuals();
        updateFaceSelectionVisuals();
        updateEditModeProxy();
    }
}

function updateVertexSelectionVisuals() {
    if (!vertexHelpers) return;
    const colors = vertexHelpers.geometry.attributes.color;
    const UNSELECTED_COLOR = new THREE.Color(0xffff00); // Yellow
    const SELECTED_COLOR = new THREE.Color(0xffa500); // Orange

    for (let i = 0; i < colors.count; i++) {
        const color = selections.vertices.has(i) ? SELECTED_COLOR : UNSELECTED_COLOR;
        colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
}

function updateFaceSelectionVisuals() {
    if (!faceHighlightHelper || !selectedObject) return;
    const selectedFaces = Array.from(selections.faces);
    if (selectedFaces.length === 0) {
        faceHighlightHelper.geometry.setIndex([]);
        faceHighlightHelper.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
        return;
    }

    const sourceGeom = selectedObject.geometry;
    const newIndices = [];
    selectedFaces.forEach(faceIndex => {
        newIndices.push(sourceGeom.index.getX(faceIndex*3), sourceGeom.index.getX(faceIndex*3+1), sourceGeom.index.getX(faceIndex*3+2));
    });

    faceHighlightHelper.geometry.setIndex(newIndices);
    faceHighlightHelper.geometry.setAttribute('position', sourceGeom.attributes.position); // Share positions
    faceHighlightHelper.geometry.computeVertexNormals();
}

function updateEdgeSelectionVisuals() {
    if (!selectedEdgeHelper || !selectedObject) return;
    const vertices = [];
    selections.edges.forEach(edgeKey => {
        const [v1_idx, v2_idx] = allEdges.get(edgeKey);
        const positions = selectedObject.geometry.attributes.position;
        vertices.push(positions.getX(v1_idx), positions.getY(v1_idx), positions.getZ(v1_idx));
        vertices.push(positions.getX(v2_idx), positions.getY(v2_idx), positions.getZ(v2_idx));
    });
    selectedEdgeHelper.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
}

function getClosestEdgeToPoint(face, point, geometry) {
    const pos = geometry.attributes.position;
    const vA = new THREE.Vector3().fromBufferAttribute(pos, face.a);
    const vB = new THREE.Vector3().fromBufferAttribute(pos, face.b);
    const vC = new THREE.Vector3().fromBufferAttribute(pos, face.c);

    const edges = [
        { indices: [face.a, face.b], line: new THREE.Line3(vA, vB) },
        { indices: [face.b, face.c], line: new THREE.Line3(vB, vC) },
        { indices: [face.c, face.a], line: new THREE.Line3(vC, vA) },
    ];

    let minDistance = Infinity;
    let closestEdge = null;
    const tempPoint = new THREE.Vector3();

    for (const edge of edges) {
        edge.line.closestPointToPoint(point, true, tempPoint);
        const dist = point.distanceTo(tempPoint);
        if (dist < minDistance) {
            minDistance = dist;
            closestEdge = edge.indices;
        }
    }
    
    return closestEdge[0] < closestEdge[1] ? `${closestEdge[0]}-${closestEdge[1]}` : `${closestEdge[1]}-${closestEdge[0]}`;
}

// --- EDIT MODE TRANSFORMATION ---

function collectAffectedVertexIndices() {
    affectedVertexIndices.clear();
    if (!selectedObject) return;

    const index = selectedObject.geometry.index;

    // From selected vertices
    for (const vertIndex of selections.vertices) {
        affectedVertexIndices.add(vertIndex);
    }

    // From selected edges
    for (const edgeKey of selections.edges) {
        const [v1, v2] = allEdges.get(edgeKey);
        affectedVertexIndices.add(v1);
        affectedVertexIndices.add(v2);
    }
    
    // From selected faces
    for (const faceIndex of selections.faces) {
        affectedVertexIndices.add(index.getX(faceIndex * 3));
        affectedVertexIndices.add(index.getX(faceIndex * 3 + 1));
        affectedVertexIndices.add(index.getX(faceIndex * 3 + 2));
    }
}

function updateEditModeProxy() {
    if (!selectedObject || currentMode !== 'EDIT') {
        transformControls.detach();
        return;
    }

    collectAffectedVertexIndices();

    if (affectedVertexIndices.size === 0) {
        transformControls.detach();
        return;
    }

    const center = new THREE.Vector3();
    const positions = selectedObject.geometry.attributes.position;
    
    for (const index of affectedVertexIndices) {
        const pos = new THREE.Vector3().fromBufferAttribute(positions, index);
        center.add(pos);
    }
    center.divideScalar(affectedVertexIndices.size);

    // Center is in local space, transform to world space for the proxy
    center.applyMatrix4(selectedObject.matrixWorld);

    editModeProxy.position.copy(center);
    transformControls.attach(editModeProxy);
}

function applyEditModeTransformation() {
    if (!isDraggingInEditMode || affectedVertexIndices.size === 0) return;

    const worldDelta = editModeProxy.position.clone().sub(dragStartProxyPosition);
    
    // Convert world delta to local delta by reversing object transforms
    const localDelta = worldDelta.clone();
    const invQuaternion = selectedObject.quaternion.clone().invert();
    localDelta.applyQuaternion(invQuaternion);
    localDelta.divide(selectedObject.scale);

    const positions = selectedObject.geometry.attributes.position;
    initialVertexPositions.forEach((initialPos, index) => {
        const newPos = initialPos.clone().add(localDelta);
        positions.setXYZ(index, newPos.x, newPos.y, newPos.z);
    });

    positions.needsUpdate = true;
    selectedObject.geometry.computeVertexNormals(); // Recalculate normals for correct lighting

    // Update helpers that depend on vertex positions
    updateEdgeSelectionVisuals();
    updateFaceSelectionVisuals();
}

init();
document.body.focus();