import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { SimplexNoise } from 'simplex-noise';
import { WebsimSocket } from 'websim';

const room = new WebsimSocket();
await room.initialize();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 65, 0); // Start a bit lower, closer to potential ground

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const loadingDiv = document.getElementById('loading');
const blockSelectorDiv = document.getElementById('block-selector');
const blockSelectorUITexturePreview = document.getElementById('block-selector-texture');

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
directionalLight.position.set(50, 50, 50);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.left = -100;
directionalLight.shadow.camera.right = 100;
directionalLight.shadow.camera.top = 100;
directionalLight.shadow.camera.bottom = -100;
scene.add(directionalLight);

// Controls
const controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject()); // Add the player camera to the scene

document.addEventListener('click', () => {
    controls.lock();
});

controls.addEventListener('lock', () => {
    console.log('Pointer locked');
});

controls.addEventListener('unlock', () => {
    console.log('Pointer unlocked');
});

// Player movement state
const movement = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    velocity: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    onGround: false,
};

const playerHeight = 1.8;
const playerSpeed = 10.0;
const jumpHeight = 1.0;
const gravity = -30.0;

document.addEventListener('keydown', (event) => {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW': movement.forward = true; break;
        case 'ArrowLeft':
        case 'KeyA': movement.left = true; break;
        case 'ArrowDown':
        case 'KeyS': movement.backward = true; break;
        case 'ArrowRight':
        case 'KeyD': movement.right = true; break;
        case 'Space': if (movement.onGround) movement.jump = true; break;
    }
});

document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'ArrowUp':
        case 'KeyW': movement.forward = false; break;
        case 'ArrowLeft':
        case 'KeyA': movement.left = false; break;
        case 'ArrowDown':
        case 'KeyS': movement.backward = false; break;
        case 'ArrowRight':
        case 'KeyD': movement.right = false; break;
    }
});

// Chunk constants
const chunkSize = 16;
const tileSize = 1;
const tileTextureWidth = 256;
const tileTextureHeight = 64;

// Block types and textures
const blockTypes = {
    grass: { top: 0, bottom: 2, side: 1, color: 0x559944 }, // Added color fallback
    dirt: { top: 2, bottom: 2, side: 2, color: 0x885522 },
    stone: { top: 3, bottom: 3, side: 3, color: 0x888888 },
    wood: { top: 4, bottom: 4, side: 5, color: 0x775533 },
    leaves: { top: 6, bottom: 6, side: 6, color: 0x44aa44 },
    sand: { top: 7, bottom: 7, side: 7, color: 0xeeeecc },
    // Add more block types here
};
const blockNames = Object.keys(blockTypes);
let selectedBlock = blockNames[0]; // Default selection

// Use MeshStandardMaterial without a map for now, allows for lighting
const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide }); // Use vertex colors

// Noise generator
const simplex = new SimplexNoise();

// Chunk management
const chunks = {};
const chunkGeometryCache = {};
const chunkMeshCache = {};
const CHUNK_COLLECTION = 'chunk_v1';
let chunkLoadQueue = [];
let isLoadingChunk = false;

function getChunkId(x, z) {
    return `${Math.floor(x / chunkSize)},${Math.floor(z / chunkSize)}`;
}

function getVoxelCoordinates(worldX, worldY, worldZ) {
    return {
        x: Math.floor(worldX),
        y: Math.floor(worldY),
        z: Math.floor(worldZ),
    };
}

function getChunkCoordinates(worldX, worldZ) {
    const chunkX = Math.floor(worldX / chunkSize);
    const chunkZ = Math.floor(worldZ / chunkSize);
    return { chunkX, chunkZ };
}

function getBlockKeyInChunk(worldX, worldY, worldZ) {
    const localX = THREE.MathUtils.euclideanModulo(Math.floor(worldX), chunkSize);
    const localY = Math.floor(worldY);
    const localZ = THREE.MathUtils.euclideanModulo(Math.floor(worldZ), chunkSize);
    return `${localX},${localY},${localZ}`;
}

// Generate chunk data
function generateChunkData(chunkX, chunkZ) {
    const blocks = {};
    const startX = chunkX * chunkSize;
    const startZ = chunkZ * chunkSize;

    for (let x = 0; x < chunkSize; x++) {
        for (let z = 0; z < chunkSize; z++) {
            const worldX = startX + x;
            const worldZ = startZ + z;

            // Simple flat grass plane for testing visibility quickly
            const height = 50; // Flat plane at y=50
            const key = `${x},${height},${z}`;
            blocks[key] = { type: 'grass' };
            // Stone below
            for (let y=0; y < height; y++) {
                 const stoneKey = `${x},${y},${z}`;
                 blocks[stoneKey] = {type: 'stone'};
            }
             // Bedrock at y=0
             const bedrockKey = `${x},0,${z}`;
             blocks[bedrockKey] = { type: 'stone', unbreakable: true };

            /* // Original noise generation - uncomment later if needed
            const noiseVal = (simplex.noise2D(worldX * 0.01, worldZ * 0.01) + 1) / 2; // Normalize to 0-1
            const height = Math.floor(noiseVal * 30) + 30; // Base terrain height 30-60

            for (let y = 0; y < height; y++) {
                const key = `${x},${y},${z}`;
                if (y === height - 1 && y > 35) { // Grass on top layer above certain height
                     blocks[key] = { type: 'grass' };
                } else if (y > height - 5 && y > 35) { // Dirt below grass
                    blocks[key] = { type: 'dirt' };
                } else if (y <= 35 && y > 30) { // Sand near water level
                     blocks[key] = { type: 'sand' };
                }
                else { // Stone below
                    blocks[key] = { type: 'stone' };
                }
            }
             // Bedrock at y=0
             const bedrockKey = `${x},0,${z}`;
             blocks[bedrockKey] = { type: 'stone', unbreakable: true }; // Using stone texture for now
            */
        }
    }
    return blocks;
}

function getBlock(worldX, worldY, worldZ) {
    const { chunkX, chunkZ } = getChunkCoordinates(worldX, worldZ);
    const chunkId = `${chunkX},${chunkZ}`;
    const chunk = chunks[chunkId];
    // If chunk or its blocks don't exist, return null (air)
    if (!chunk || !chunk.blocks) {
        // Check if coordinates are within world generation bounds (e.g., y > 0)
        if (worldY < 0) return { type: 'stone', unbreakable: true }; // Treat below 0 as bedrock conceptually
        return null;
    }

    const blockKey = getBlockKeyInChunk(worldX, worldY, worldZ);
    return chunk.blocks[blockKey] || null; // Return block or null if key doesn't exist
}

// Create chunk geometry
function createChunkGeometry(chunkX, chunkZ, chunkData) {
    const chunkId = `${chunkX},${chunkZ}`;
    const chunkBlocks = chunkData.blocks || {};
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const normals = [];
    // const uvs = []; // Not needed without texture map
    const colors = []; // Added for vertex colors
    const indices = [];
    let index = 0;

    const startX = chunkX * chunkSize;
    const startZ = chunkZ * chunkSize;
    const tempColor = new THREE.Color(); // For color conversion

    for (const key in chunkBlocks) {
        const [lx, ly, lz] = key.split(',').map(Number);
        const block = chunkBlocks[key];
        if (!block) continue;

        const blockInfo = blockTypes[block.type];
        if (!blockInfo) {
             console.warn(`Unknown block type: ${block.type} at ${key}`);
             continue;
        }
        const blockColor = new THREE.Color(blockInfo.color || 0xffffff); // Use defined color or white


        const worldX = startX + lx;
        const worldY = ly;
        const worldZ = startZ + lz;

        // Check neighbors - IMPORTANT: Must check across chunk boundaries
        const neighbors = {
            nx: getBlock(worldX - 1, worldY, worldZ),
            px: getBlock(worldX + 1, worldY, worldZ),
            ny: getBlock(worldX, worldY - 1, worldZ),
            py: getBlock(worldX, worldY + 1, worldZ),
            nz: getBlock(worldX, worldY, worldZ - 1),
            pz: getBlock(worldX, worldY, worldZ + 1),
        };

        // Simpler face definitions since UVs are not needed
         const faces = [
            { dir: [-1, 0, 0], corners: [ [0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1] ], neighbor: neighbors.nx }, // nx
            { dir: [ 1, 0, 0], corners: [ [1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0] ], neighbor: neighbors.px }, // px
            { dir: [ 0,-1, 0], corners: [ [1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0] ], neighbor: neighbors.ny }, // ny - Bottom
            { dir: [ 0, 1, 0], corners: [ [0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0] ], neighbor: neighbors.py }, // py - Top
            { dir: [ 0, 0,-1], corners: [ [1, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 0] ], neighbor: neighbors.nz }, // nz
            { dir: [ 0, 0, 1], corners: [ [0, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 1] ], neighbor: neighbors.pz }, // pz
        ];

        for (const { dir, corners, neighbor } of faces) {
             // Only render face if neighbor is air (null)
            if (!neighbor) {
                const ndx = positions.length / 3;
                for (const pos of corners) {
                    positions.push(pos[0] + worldX, pos[1] + worldY, pos[2] + worldZ);
                    normals.push(...dir);
                    // Apply vertex color - slightly darken based on normal for subtle shading
                    tempColor.copy(blockColor);
                    if (dir[1] === 1) tempColor.multiplyScalar(1.0); // Top face brightest
                    else if (dir[1] === -1) tempColor.multiplyScalar(0.7); // Bottom face darkest
                    else tempColor.multiplyScalar(0.85); // Side faces
                    colors.push(tempColor.r, tempColor.g, tempColor.b);
                }

                // uvs.push(0, 0, 1, 0, 0, 1, 1, 1); // Dummy UVs if needed, but vertexColors is used

                indices.push(
                    ndx, ndx + 1, ndx + 2,
                    ndx + 2, ndx + 1, ndx + 3,
                );
                 index += 6; // 2 triangles per face
            }
        }
    }

    if (positions.length === 0) {
         // console.log(`Chunk ${chunkId} generated no geometry.`);
         return null; // Return null if no geometry to avoid errors
     }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    // geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); // No UVs needed now
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); // Add color attribute
    geometry.setIndex(indices);
    geometry.computeBoundingSphere(); // Important for frustum culling

    chunkGeometryCache[chunkId] = geometry;
    // console.log(`Generated geometry for chunk ${chunkId} with ${positions.length / 3} vertices.`);
    return geometry;
}

// Function to load or generate a chunk
async function loadOrGenerateChunk(chunkX, chunkZ) {
    const chunkId = `${chunkX},${chunkZ}`;
    // Prevent queuing if already loaded, being processed by this client, or actively being loaded
     if (chunks[chunkId] || chunkLoadQueue.includes(chunkId) || isLoadingChunk && chunkLoadQueue[0] === chunkId) {
        return;
    }

    // console.log(`Queueing chunk load: ${chunkId}`);
    chunkLoadQueue.push(chunkId);
    if (!isLoadingChunk) { // Start processing immediately if queue was empty
        processChunkQueue();
    }
}

async function processChunkQueue() {
    if (chunkLoadQueue.length === 0) {
         isLoadingChunk = false;
         // console.log("Chunk queue empty.");
         updateLoadingStatus();
        return;
    }

    isLoadingChunk = true;
    const chunkId = chunkLoadQueue[0]; // Peek at the front
    const [chunkX, chunkZ] = chunkId.split(',').map(Number);
    // console.log(`Processing chunk: ${chunkId}`);
    updateLoadingStatus();


    // Try to get from DB
    let chunkData = null;
    try {
         chunkData = await room.collection(CHUNK_COLLECTION).get(chunkId);
    } catch(e) {
        console.warn(`Error fetching chunk ${chunkId} from DB (might not exist yet):`, e);
        // Proceed to generation if fetch failed (e.g., network error or not found)
    }


    if (!chunkData || !chunkData.blocks) { // If not in DB or has no blocks field
        // console.log(`Chunk ${chunkId} not found or invalid in DB, generating...`);
        const generatedBlocks = generateChunkData(chunkX, chunkZ);
        try {
            // Use create which handles potential race conditions better if id is provided
             chunkData = await room.collection(CHUNK_COLLECTION).create({
                id: chunkId,
                chunkX: chunkX,
                chunkZ: chunkZ,
                blocks: generatedBlocks,
            });
            console.log(`Generated and saved chunk: ${chunkId}`);
        } catch (e) {
            if (e && e.message && e.message.includes('already exists')) {
                 console.log(`Chunk ${chunkId} already exists (race condition?), fetching again.`);
                 try {
                    chunkData = await room.collection(CHUNK_COLLECTION).get(chunkId);
                 } catch (fetchError) {
                     console.error(`Error fetching chunk ${chunkId} after creation conflict:`, fetchError);
                     chunkData = null; // Ensure it's null if fetch fails
                 }
             } else {
                 console.error(`Error creating chunk ${chunkId}:`, e);
                 chunkData = null; // Ensure it's null if creation fails
             }
        }

    } else {
        // console.log(`Loaded chunk from DB: ${chunkId}`);
    }


    // Remove the processed chunk ID from the front of the queue *after* processing attempt
    chunkLoadQueue.shift();

    if (chunkData && chunkData.blocks) {
        chunks[chunkId] = chunkData;
        // console.log(`Updating mesh for chunk ${chunkId}`);
        updateChunkMesh(chunkX, chunkZ, chunkData);
    } else {
        console.error(`Failed to load or generate valid chunk data for ${chunkId}.`);
    }

    isLoadingChunk = false;
    // Process next chunk in the queue without delay for faster loading
    // Use requestAnimationFrame to yield to the browser briefly
    requestAnimationFrame(processChunkQueue);
     // setTimeout(processChunkQueue, 0); // Or setTimeout 0
}

function updateChunkMesh(chunkX, chunkZ, chunkData) {
    const chunkId = `${chunkX},${chunkZ}`;

     // Remove existing mesh if it exists
     if (chunkMeshCache[chunkId]) {
        scene.remove(chunkMeshCache[chunkId]);
        chunkMeshCache[chunkId].geometry.dispose(); // Dispose old geometry
        delete chunkMeshCache[chunkId];
        // Don't delete geometry cache immediately, createChunkGeometry will overwrite
    }


    const geometry = createChunkGeometry(chunkX, chunkZ, chunkData);
    // Ensure geometry is valid and has vertices before creating a mesh
    if (geometry && geometry.attributes.position && geometry.attributes.position.count > 0) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { chunkId }; // Store chunkId for potential future use
        scene.add(mesh);
        chunkMeshCache[chunkId] = mesh;
        // console.log(`Added mesh for chunk ${chunkId} to scene.`);
    } else {
         // console.log(`Chunk ${chunkId} resulted in no geometry or empty geometry, skipping mesh creation.`);
          // Ensure no old mesh lingers if new geometry is null/empty
         if (chunkMeshCache[chunkId]) {
             scene.remove(chunkMeshCache[chunkId]);
             delete chunkMeshCache[chunkId];
         }
    }
}

// Render distance
const renderDistance = 4; // Chunks in each direction (reduced for faster initial load)

function updateVisibleChunks() {
    const playerPos = controls.getObject().position;
     // Handle potential NaN positions early on
    if (isNaN(playerPos.x) || isNaN(playerPos.z)) {
        console.warn("Player position is NaN, skipping chunk update.");
        return;
    }

    const playerChunkX = Math.floor(playerPos.x / chunkSize);
    const playerChunkZ = Math.floor(playerPos.z / chunkSize);

    const previouslyVisible = new Set(Object.keys(chunkMeshCache));
    const currentlyNeeded = new Set(); // Renamed from currentlyVisible

    // Determine needed chunks
    for (let x = playerChunkX - renderDistance; x <= playerChunkX + renderDistance; x++) {
        for (let z = playerChunkZ - renderDistance; z <= playerChunkZ + renderDistance; z++) {
            const chunkId = `${x},${z}`;
             currentlyNeeded.add(chunkId);
            // If chunk data not loaded AND not already queued AND not currently being processed
            if (!chunks[chunkId] && !chunkLoadQueue.includes(chunkId) && !(isLoadingChunk && chunkLoadQueue[0] === chunkId)) {
                loadOrGenerateChunk(x, z); // Queue it for loading/generation
            } else if (chunks[chunkId] && !chunkMeshCache[chunkId]) {
                 // Data is loaded, but mesh isn't visible, maybe it was unloaded? Recreate mesh.
                 // console.log(`Recreating mesh for already loaded chunk: ${chunkId}`);
                 updateChunkMesh(x, z, chunks[chunkId]);
            }
        }
    }

     // Unload meshes for chunks that are no longer needed
    previouslyVisible.forEach(chunkId => {
        if (!currentlyNeeded.has(chunkId)) {
            if (chunkMeshCache[chunkId]) {
                // console.log(`Unloading mesh for chunk: ${chunkId}`);
                scene.remove(chunkMeshCache[chunkId]);
                 // Consider disposing geometry here if memory becomes an issue,
                 // but keeping it cached might speed up re-entering the area.
                 // chunkMeshCache[chunkId].geometry.dispose();
                 // delete chunkGeometryCache[chunkId];
                delete chunkMeshCache[chunkId];
                 // Keep the chunk data in `chunks` cache
            }
        }
    });

    updateLoadingStatus(); // Update UI based on queue length
}

function updateLoadingStatus() {
     if (loadingDiv) {
        const queueSize = chunkLoadQueue.length + (isLoadingChunk ? 1 : 0);
        if (queueSize > 0) {
            loadingDiv.style.display = 'block';
            loadingDiv.textContent = `Loading Chunks... (${queueSize} remaining)`;
        } else {
            loadingDiv.style.display = 'none';
        }
    }
}

// Block placement and removal logic
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(); // Not used with pointer lock, but kept for structure

window.addEventListener('mousedown', (event) => {
     if (!controls.isLocked) return;


    raycaster.setFromCamera({ x: 0, y: 0 }, camera); // Raycast from center of screen
    // Ensure chunk meshes are intersected
    const meshesToIntersect = Object.values(chunkMeshCache);
    if (meshesToIntersect.length === 0) return; // Don't raycast if no meshes exist

    const intersects = raycaster.intersectObjects(meshesToIntersect, false);


    if (intersects.length > 0) {
        const intersection = intersects[0];
         // Check distance to prevent modifying blocks too far away
         if (intersection.distance > 6) {
             console.log("Too far to modify block.");
             return;
         }

        const point = intersection.point;
        const normal = intersection.face.normal.clone().normalize(); // Ensure it's normalized


        // Calculate voxel coordinates based on click type
        let voxelPos;
        if (event.button === 0) { // Left click: Remove block
            voxelPos = getVoxelCoordinates(
                point.x - normal.x * 0.01, // Move slightly inside the clicked face
                point.y - normal.y * 0.01,
                point.z - normal.z * 0.01
            );
             // console.log("Removing block at:", voxelPos);
             modifyBlock(voxelPos.x, voxelPos.y, voxelPos.z, null); // Remove block
        } else if (event.button === 2) { // Right click: Place block
             voxelPos = getVoxelCoordinates(
                point.x + normal.x * 0.01, // Move slightly outside the clicked face
                point.y + normal.y * 0.01,
                point.z + normal.z * 0.01
            );
             // console.log("Placing block at:", voxelPos, "Type:", selectedBlock);

             // Basic collision check: Don't place block inside player
            const playerPos = controls.getObject().position;
             // Check both the feet and head positions of the player capsule
             const playerFeetY = playerPos.y - playerHeight / 2;
             const playerHeadY = playerPos.y + playerHeight / 2;
             const playerVoxelFoot = getVoxelCoordinates(playerPos.x, playerFeetY + 0.1, playerPos.z); // Check slightly above feet
             const playerVoxelHead = getVoxelCoordinates(playerPos.x, playerHeadY - 0.1, playerPos.z); // Check slightly below head


            if ( (voxelPos.x === playerVoxelFoot.x && voxelPos.y === playerVoxelFoot.y && voxelPos.z === playerVoxelFoot.z) ||
                 (voxelPos.x === playerVoxelHead.x && voxelPos.y === playerVoxelHead.y && voxelPos.z === playerVoxelHead.z) )
                 {
                 console.log("Cannot place block inside player");
                 return;
            }


            modifyBlock(voxelPos.x, voxelPos.y, voxelPos.z, { type: selectedBlock }); // Place selected block
        }
    }
});

async function modifyBlock(worldX, worldY, worldZ, newBlock) {
     if (worldY < 0) return; // Cannot modify below y=0


    const { chunkX, chunkZ } = getChunkCoordinates(worldX, worldZ);
    const chunkId = `${chunkX},${chunkZ}`;
    const blockKey = getBlockKeyInChunk(worldX, worldY, worldZ);


    let chunkData = chunks[chunkId];
    // If chunk data isn't loaded locally yet, try to fetch it before modifying
    if (!chunkData) {
        console.log(`Chunk ${chunkId} not loaded locally, attempting fetch before modification.`);
        try {
            chunkData = await room.collection(CHUNK_COLLECTION).get(chunkId);
            if (chunkData) {
                chunks[chunkId] = chunkData; // Store fetched data
            } else {
                 console.error(`Attempted to modify non-existent chunk: ${chunkId}`);
                return; // Chunk doesn't exist in DB either
            }
        } catch (e) {
            console.error(`Error fetching chunk ${chunkId} for modification:`, e);
            return; // Failed to fetch
        }
    }

     // Ensure blocks object exists
     if (!chunkData.blocks) {
        chunkData.blocks = {};
     }


     // Check if block is unbreakable
    const existingBlock = chunkData.blocks[blockKey];
     // Can't break bedrock (y=0) or explicitly unbreakable blocks
    if ((worldY === 0 || (existingBlock && existingBlock.unbreakable)) && newBlock === null) {
        console.log("Cannot break unbreakable block or bedrock");
        return;
    }


    // Optimistic update
    const oldBlocks = { ...chunkData.blocks }; // Deep clone might be needed if block data becomes complex
    const previousBlock = chunkData.blocks[blockKey]; // Store the specific block being changed

    if (newBlock) {
        // Avoid placing the exact same block again
        if (existingBlock && existingBlock.type === newBlock.type) {
            // console.log("Block already exists.");
            return;
        }
        chunkData.blocks[blockKey] = newBlock;
    } else {
         // Avoid deleting if already air
        if (!existingBlock) {
             // console.log("Block already air.");
             return;
         }
        delete chunkData.blocks[blockKey];
    }

    console.log(`Optimistic update: ${newBlock ? 'Placing' : 'Removing'} block at ${blockKey} in ${chunkId}`);
    updateChunkMesh(chunkX, chunkZ, chunkData); // Update local mesh immediately


     // Determine which neighbor chunks might need their meshes rebuilt due to boundary changes
     const localX = THREE.MathUtils.euclideanModulo(Math.floor(worldX), chunkSize);
     const localZ = THREE.MathUtils.euclideanModulo(Math.floor(worldZ), chunkSize);
     const neighborsToUpdate = new Set(); // Use a Set to avoid duplicates
     if (localX === 0) neighborsToUpdate.add(`${chunkX - 1},${chunkZ}`);
     if (localX === chunkSize - 1) neighborsToUpdate.add(`${chunkX + 1},${chunkZ}`);
     if (localZ === 0) neighborsToUpdate.add(`${chunkX},${chunkZ - 1}`);
     if (localZ === chunkSize - 1) neighborsToUpdate.add(`${chunkX},${chunkZ + 1}`);


     neighborsToUpdate.forEach((neighborId) => {
         const neighborData = chunks[neighborId];
         if (neighborData && chunkMeshCache[neighborId]) { // Update only if loaded and mesh exists
            // console.log(`Updating neighbor mesh: ${neighborId}`);
            const { chunkX: nx, chunkZ: nz } = getChunkCoordinatesFromId(neighborId);
            updateChunkMesh(nx, nz, neighborData);
         }
     });


    // Update database
    try {
        await room.collection(CHUNK_COLLECTION).update(chunkId, {
            blocks: chunkData.blocks, // Send the entire updated blocks object
        });
        // console.log(`Successfully updated chunk ${chunkId} in DB`);
    } catch (error) {
        console.error(`Failed to update chunk ${chunkId} in DB:`, error);
        // Revert optimistic update
        chunkData.blocks = oldBlocks; // Restore the entire previous block state for the chunk
        updateChunkMesh(chunkX, chunkZ, chunkData); // Re-render the chunk with old data
         // Also revert neighbor meshes if they were updated
         neighborsToUpdate.forEach((neighborId) => {
             const neighborData = chunks[neighborId];
             if (neighborData && chunkMeshCache[neighborId]) {
                 const { chunkX: nx, chunkZ: nz } = getChunkCoordinatesFromId(neighborId);
                 updateChunkMesh(nx, nz, neighborData); // Rerender neighbor with its (now correct) state
             }
         });
    }
}

// Subscribe to chunk updates from other players
room.collection(CHUNK_COLLECTION).subscribe((updatedChunkList) => {
    // No need to sort, just process all incoming updates
    updatedChunkList.forEach(dbChunkData => {
        const chunkId = dbChunkData.id;
        const localChunkData = chunks[chunkId];

        // Check if the incoming data is actually different from local cache
        // Simple JSON compare, might be slow for large chunks, consider hash comparison later
         const hasChanged = !localChunkData || JSON.stringify(localChunkData.blocks) !== JSON.stringify(dbChunkData.blocks);

        if (hasChanged) {
             // console.log(`Received update for chunk: ${chunkId}`);
             chunks[chunkId] = dbChunkData; // Update local cache with new data

             const { chunkX, chunkZ } = getChunkCoordinatesFromId(chunkId);

             // Only update mesh if the chunk is currently supposed to be visible
            const playerChunkX = Math.floor(controls.getObject().position.x / chunkSize);
            const playerChunkZ = Math.floor(controls.getObject().position.z / chunkSize);
             const isVisible = Math.abs(chunkX - playerChunkX) <= renderDistance && Math.abs(chunkZ - playerChunkZ) <= renderDistance;

            if (isVisible) {
                // console.log(`Updating mesh for remotely modified visible chunk: ${chunkId}`);
                updateChunkMesh(chunkX, chunkZ, dbChunkData);

                 // Also force update neighbors if they are visible, as their geometry might depend on this chunk
                 const neighbors = [
                    `${chunkX-1},${chunkZ}`, `${chunkX+1},${chunkZ}`,
                    `${chunkX},${chunkZ-1}`, `${chunkX},${chunkZ+1}`
                 ];
                 neighbors.forEach(neighborId => {
                      const neighborCoords = getChunkCoordinatesFromId(neighborId);
                      const isNeighborVisible = Math.abs(neighborCoords.chunkX - playerChunkX) <= renderDistance && Math.abs(neighborCoords.chunkZ - playerChunkZ) <= renderDistance;
                     // Update neighbor only if its data exists locally and it's currently visible
                     if (chunks[neighborId] && isNeighborVisible) {
                         // console.log(`Updating neighbor mesh ${neighborId} due to update in ${chunkId}`);
                         updateChunkMesh(neighborCoords.chunkX, neighborCoords.chunkZ, chunks[neighborId]);
                     }
                 });
            }
        }
    });
});

function getChunkCoordinatesFromId(chunkId) {
     const parts = chunkId.split(',');
     if (parts.length !== 2) {
         console.error(`Invalid chunkId format: ${chunkId}`);
         return { chunkX: 0, chunkZ: 0 }; // Return default or throw error
     }
     const chunkX = parseInt(parts[0], 10);
     const chunkZ = parseInt(parts[1], 10);
      if (isNaN(chunkX) || isNaN(chunkZ)) {
         console.error(`Non-numeric coordinates in chunkId: ${chunkId}`);
         return { chunkX: 0, chunkZ: 0 }; // Return default
     }
     return { chunkX, chunkZ };
}

// Block Selector UI
function setupBlockSelector() {
     // Clear existing options if any
    blockSelectorDiv.innerHTML = '';
    blockNames.forEach(name => {
        const option = document.createElement('div');
        option.classList.add('block-option');
        // option.style.background = `url(textures.png)`; // Removed texture dependency
        const blockInfo = blockTypes[name];
        option.style.backgroundColor = `#${new THREE.Color(blockInfo.color || 0xffffff).getHexString()}`; // Use block color

        /* // Texture based selector - keep commented for now
        const tileIndex = blockInfo.side; // Use the side texture for the preview
        const tilesPerRow = 4;
        const tileSizePx = 64; // Assuming texture is 256x64, each tile is 64x64
        const xOffset = (tileIndex % tilesPerRow) * tileSizePx;
        const yOffset = Math.floor(tileIndex / tilesPerRow) * tileSizePx;
        option.style.backgroundPosition = `-${xOffset}px -${yOffset}px`;
        option.style.backgroundSize = `${tileTextureWidth}px ${tileTextureHeight}px`;
        */

        option.title = name; // Add tooltip
        option.dataset.blockType = name;
        option.addEventListener('click', () => {
            selectedBlock = name;
            updateSelectorUI();
        });
        blockSelectorDiv.appendChild(option);
    });
    updateSelectorUI(); // Set initial selection style
}

function updateSelectorUI() {
    const options = blockSelectorDiv.querySelectorAll('.block-option');
    options.forEach(opt => {
        if (opt.dataset.blockType === selectedBlock) {
            opt.classList.add('selected');
        } else {
            opt.classList.remove('selected');
        }
    });
}

// Collision Detection Raycasters
const downRaycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, playerHeight / 2 + 0.1);

function checkCollisions(delta) {
     const playerPosition = controls.getObject().position;
     const onGroundPrev = movement.onGround;
     movement.onGround = false;
     const meshesToIntersect = Object.values(chunkMeshCache);

     // --- Ground Check ---
     downRaycaster.ray.origin.copy(playerPosition);
      downRaycaster.ray.origin.y += 0.1; // Start ray slightly above player center base
      downRaycaster.far = playerHeight / 2 + 0.2; // Check distance below center

      if (meshesToIntersect.length > 0) {
         const groundIntersects = downRaycaster.intersectObjects(meshesToIntersect, false);
         if (groundIntersects.length > 0) {
             const distanceToGround = groundIntersects[0].distance;
             const groundThreshold = playerHeight / 2 + 0.1; // How close feet need to be

             if (distanceToGround <= groundThreshold) {
                 movement.onGround = true;
                 // Snap to ground if falling onto it
                 if (movement.velocity.y < 0) {
                     // Adjust position to be exactly on ground + small offset
                     playerPosition.y -= (distanceToGround - playerHeight / 2 - 0.01);
                     movement.velocity.y = 0; // Stop falling velocity
                 }
             }
         }
     }


     // Apply gravity if not on ground
     if (!movement.onGround) {
         movement.velocity.y += gravity * delta;
     } else {
         // Reset downward velocity if grounded and not jumping
         movement.velocity.y = Math.max(0, movement.velocity.y);
     }


     // --- Jumping ---
     if (movement.jump) {
         if (movement.onGround) {
             // Calculate jump velocity needed to reach jumpHeight
             movement.velocity.y = Math.sqrt(2 * jumpHeight * Math.abs(gravity));
             movement.onGround = false; // No longer on ground after jumping
         }
         movement.jump = false; // Consume jump impulse
     }


     // --- Horizontal Movement --- (Simplified - no wall collision yet)
     movement.velocity.x -= movement.velocity.x * 10.0 * delta; // Damping
     movement.velocity.z -= movement.velocity.z * 10.0 * delta; // Damping


     movement.direction.z = Number(movement.forward) - Number(movement.backward);
     movement.direction.x = Number(movement.left) - Number(movement.right);
     movement.direction.normalize(); // Ensure consistent speed


     const currentSpeed = playerSpeed * (movement.onGround ? 1 : 0.7); // Slightly less air control


     if (movement.forward || movement.backward) movement.velocity.z -= movement.direction.z * currentSpeed * delta * 100; // Apply speed more directly
     if (movement.left || movement.right) movement.velocity.x -= movement.direction.x * currentSpeed * delta * 100;


     // Move player based on camera direction
     controls.moveRight(-movement.velocity.x * delta);
     controls.moveForward(-movement.velocity.z * delta);


     // Apply vertical movement (gravity/jump)
     playerPosition.y += movement.velocity.y * delta;


     // Basic world bounds check (prevent falling infinitely)
     if (playerPosition.y < -20) {
         playerPosition.y = 100; // Respawn high up
         playerPosition.x = 0;
         playerPosition.z = 0;
         movement.velocity.y = 0;
         movement.velocity.x = 0;
         movement.velocity.z = 0;
         // Force chunk reload around spawn
         chunks = {}; // Clear local chunk cache
         Object.values(chunkMeshCache).forEach(mesh => scene.remove(mesh)); // Remove all meshes
         chunkMeshCache = {};
         chunkGeometryCache = {};
         chunkLoadQueue = [];
         isLoadingChunk = false;
         updateVisibleChunks();
     }


     // Send presence update
     if (controls.isLocked && Date.now() - lastPresenceUpdate > 50) { // Limit update rate and only when locked
        const basePosition = { x: playerPosition.x, y: playerPosition.y - playerHeight/2 , z: playerPosition.z }; // Send base position
        const currentRotation = { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z };
        // Basic check to avoid sending redundant updates if nothing changed
        if (JSON.stringify(basePosition) !== JSON.stringify(lastSentPosition) || JSON.stringify(currentRotation) !== JSON.stringify(lastSentRotation)) {
             room.updatePresence({
                position: basePosition,
                rotation: currentRotation
            });
            lastPresenceUpdate = Date.now();
            lastSentPosition = basePosition;
            lastSentRotation = currentRotation;
        }
    }
}

let lastPresenceUpdate = 0;
let lastSentPosition = null;
let lastSentRotation = null;
const clock = new THREE.Clock();

// Initial setup
setupBlockSelector();
updateVisibleChunks(); // Initial chunk load request

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1); // Cap delta to prevent physics jumps


     // Only update physics and chunks if controls are locked
     if (controls.isLocked) {
        checkCollisions(delta); // Update player physics and movement
        updateVisibleChunks(); // Load/unload chunks based on player position
    }


    // Always render
    renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start the game loop
console.log("Starting animation loop...");
animate();