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
// Start slightly higher to ensure we are above the initial ground
camera.position.set(5, 65, 5); // Offset slightly from chunk center
camera.lookAt(0, 50, 0); // Look towards the expected ground center

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const loadingDiv = document.getElementById('loading');
const blockSelectorDiv = document.getElementById('block-selector');
const instructionsDiv = document.getElementById('instructions');

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

document.addEventListener('click', () => {
    if (!controls.isLocked) { // Only lock if not already locked
         controls.lock();
    }
});

controls.addEventListener('lock', () => {
    console.log('Pointer locked');
    // Add camera controller to scene when locked to make moveRight/moveForward work relative to look direction
    scene.add(controls.getObject());
    // Optionally hide block selector or other UI elements
    blockSelectorDiv.style.display = 'flex'; // Show block selector
    instructionsDiv.style.display = 'none'; // Hide instructions
});

controls.addEventListener('unlock', () => {
    console.log('Pointer unlocked');
     // Remove camera controller from scene when unlocked
     scene.remove(controls.getObject());
     // Optionally show menu or other UI elements
     blockSelectorDiv.style.display = 'flex'; // Keep selector visible
     instructionsDiv.style.display = 'block'; // Show instructions again
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
const jumpHeight = 8.0; // Increased jump height slightly for effect
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

// Block types and textures
const blockTypes = {
    grass: { color: 0x559944 },
    dirt: { color: 0x885522 },
    stone: { color: 0x888888 },
    wood: { color: 0x775533 }, // Placeholder wood color
    leaves: { color: 0x44aa44 },
    sand: { color: 0xeeeecc },
    bedrock: { color: 0x444444, unbreakable: true }, // Added bedrock type
    // Add more block types here
};
const blockNames = Object.keys(blockTypes);
let selectedBlock = blockNames[0]; // Default selection

// Use MeshStandardMaterial with vertex colors
const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide });

// Noise generator
const simplex = new SimplexNoise();

// Chunk management
const chunks = {}; 
const chunkMeshCache = {}; 
const CHUNK_COLLECTION = 'chunk_v2'; 
let chunkLoadQueue = new Set(); 
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

            // Flat plane for testing
             const height = 50;
             blocks[`${x},${height},${z}`] = { type: 'grass' };
             for (let y = 1; y < height; y++) {
                 blocks[`${x},${y},${z}`] = { type: 'stone' };
             }
            // Bedrock at y=0
            blocks[`${x},0,${z}`] = { type: 'bedrock' };
        }
    }
    return blocks;
}

function getBlock(worldX, worldY, worldZ) {
     if (worldY < 0) return blockTypes.bedrock; // Treat below 0 as bedrock conceptually

    const { chunkX, chunkZ } = getChunkCoordinates(worldX, worldZ);
    const chunkId = `${chunkX},${chunkZ}`;
    const chunk = chunks[chunkId];

    if (!chunk || !chunk.blocks) {
        // We don't know what's there, assume air for geometry generation
        return null;
    }

    const blockKey = getBlockKeyInChunk(worldX, worldY, worldZ);
    const blockData = chunk.blocks[blockKey];

     // Return the block data itself, not just the type
     // The geometry function will look up the type info (color etc)
    return blockData || null; // Return block data object or null if air
}

// Create chunk geometry
function createChunkGeometry(chunkX, chunkZ, chunkData) {
    const chunkId = `${chunkX},${chunkZ}`;
    // Use blocks from provided chunkData, default to empty if missing
    const chunkBlocks = chunkData?.blocks ?? {};
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];

    const startX = chunkX * chunkSize;
    const startZ = chunkZ * chunkSize;
    const tempColor = new THREE.Color();

    for (const key in chunkBlocks) {
        const [lx, ly, lz] = key.split(',').map(Number);
        const blockData = chunkBlocks[key]; // The object { type: '...' }
        if (!blockData || !blockData.type) continue; // Skip if block is malformed

        const blockInfo = blockTypes[blockData.type];
        if (!blockInfo) {
             console.warn(`Unknown block type: ${blockData.type} at ${key} in chunk ${chunkId}`);
             continue;
        }
        const blockColor = new THREE.Color(blockInfo.color || 0xffffff);


        const worldX = startX + lx;
        const worldY = ly;
        const worldZ = startZ + lz;

        // Check neighbors - IMPORTANT: Must check across chunk boundaries
        // getBlock now returns the block data object { type: ... } or null
        const neighbors = {
            nx: getBlock(worldX - 1, worldY, worldZ),
            px: getBlock(worldX + 1, worldY, worldZ),
            ny: getBlock(worldX, worldY - 1, worldZ),
            py: getBlock(worldX, worldY + 1, worldZ),
            nz: getBlock(worldX, worldY, worldZ - 1),
            pz: getBlock(worldX, worldY, worldZ + 1),
        };

        // Simplified face definitions
         const faces = [
            { dir: [-1, 0, 0], corners: [ [0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1] ], neighbor: neighbors.nx }, // nx
            { dir: [ 1, 0, 0], corners: [ [1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0] ], neighbor: neighbors.px }, // px
            { dir: [ 0,-1, 0], corners: [ [1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0] ], neighbor: neighbors.ny }, // ny - Bottom
            { dir: [ 0, 1, 0], corners: [ [0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0] ], neighbor: neighbors.py }, // py - Top
            { dir: [ 0, 0,-1], corners: [ [1, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 0] ], neighbor: neighbors.nz }, // nz
            { dir: [ 0, 0, 1], corners: [ [0, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 1] ], neighbor: neighbors.pz }, // pz
        ];

        for (const { dir, corners, neighbor } of faces) {
             // Only render face if neighbor is air (null) or maybe transparent later
            if (!neighbor) { // Basic check: neighbor is null (air)
                const ndx = positions.length / 3;
                for (const pos of corners) {
                    positions.push(pos[0] + worldX, pos[1] + worldY, pos[2] + worldZ);
                    normals.push(...dir);
                    // Apply vertex color - slightly darken based on normal
                    tempColor.copy(blockColor);
                    if (dir[1] === 1) tempColor.multiplyScalar(1.0); // Top face brightest
                    else if (dir[1] === -1) tempColor.multiplyScalar(0.7); // Bottom face darkest
                    else tempColor.multiplyScalar(0.85); // Side faces
                    colors.push(tempColor.r, tempColor.g, tempColor.b);
                }
                indices.push(
                    ndx, ndx + 1, ndx + 2,
                    ndx + 2, ndx + 1, ndx + 3,
                );
            }
        }
    }

    if (positions.length === 0) {
         // console.log(`Chunk ${chunkId} generated no geometry.`);
         return null; // Return null if no geometry
     }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    // console.log(`Generated geometry for chunk ${chunkId} with ${positions.length / 3} vertices.`);
    return geometry;
}

// Function to load or generate a chunk
async function queueChunkLoad(chunkX, chunkZ) {
    const chunkId = `${chunkX},${chunkZ}`;
    // Prevent queuing if already loaded or already in queue
     if (chunks[chunkId] || chunkLoadQueue.has(chunkId)) {
        return;
    }

    // console.log(`Queueing chunk load: ${chunkId}`);
    chunkLoadQueue.add(chunkId);
    // Trigger processing if not already running
    if (!isLoadingChunk) {
        // Use setTimeout to yield briefly, allowing other tasks (like rendering)
        setTimeout(processChunkQueue, 0);
    }
}

async function processChunkQueue() {
    if (chunkLoadQueue.size === 0) {
         isLoadingChunk = false;
         updateLoadingStatus();
         // console.log("Chunk queue empty.");
        return;
    }

    isLoadingChunk = true;
    // Get *one* chunk ID from the Set to process
    const chunkId = chunkLoadQueue.values().next().value;
    chunkLoadQueue.delete(chunkId); // Remove it immediately

    const [chunkX, chunkZ] = chunkId.split(',').map(Number);
    // console.log(`Processing chunk: ${chunkId}. Remaining in queue: ${chunkLoadQueue.size}`);
    updateLoadingStatus();

    let chunkData = null;
    let source = 'cache'; // Track where data came from

    // 1. Check local cache first (redundant with initial check in queueChunkLoad, but safe)
    if (chunks[chunkId]) {
        chunkData = chunks[chunkId];
    } else {
        // 2. Try to get from DB
        try {
             source = 'db';
             chunkData = await room.collection(CHUNK_COLLECTION).get(chunkId);
              if (!chunkData?.blocks) { // Check if DB data is valid
                // console.log(`Chunk ${chunkId} from DB is invalid or missing blocks.`);
                chunkData = null; // Treat as not found
            } else {
                 // console.log(`Loaded chunk from DB: ${chunkId}`);
            }
        } catch (e) {
            // Log error only if it's not a "not found" type error (depends on DB implementation)
            // console.warn(`Chunk ${chunkId} not found in DB (expected for new chunks):`, e.message);
            chunkData = null; // Ensure it's null if fetch failed or not found
        }
    }

    // 3. If not found in cache or DB, generate it
    if (!chunkData) {
        source = 'generated';
        // console.log(`Generating chunk data for ${chunkId}...`);
        const generatedBlocks = generateChunkData(chunkX, chunkZ);
        const newChunkRecord = {
            id: chunkId,
            chunkX: chunkX,
            chunkZ: chunkZ,
            blocks: generatedBlocks,
        };
        // Store locally immediately
        chunks[chunkId] = newChunkRecord;
        chunkData = newChunkRecord; // Use the newly generated data

        // Attempt to save to DB asynchronously (don't wait for it)
        room.collection(CHUNK_COLLECTION).create(newChunkRecord)
            .then(() => {
                // console.log(`Saved generated chunk ${chunkId} to DB.`);
            })
            .catch(async (e) => {
                // Handle potential race condition where another client created it first
                if (e && e.message && e.message.includes('already exists')) {
                    // console.log(`Chunk ${chunkId} already exists in DB (race condition).`);
                    // Optional: Fetch the DB version to ensure consistency, though local version might be fine.
                    // try { chunks[chunkId] = await room.collection(CHUNK_COLLECTION).get(chunkId) } catch{}
                } else {
                    console.error(`Error saving generated chunk ${chunkId} to DB:`, e);
                    // Should we revert the local generation? Maybe not, prefer local playability.
                }
            });
    }

    // Update local cache (might be redundant if generated, but ensures consistency)
    if (chunkData) {
        chunks[chunkId] = chunkData;
        // Update mesh only if the data is valid and came from DB or generation
        if (chunkData.blocks && (source === 'db' || source === 'generated')) {
            // console.log(`Updating mesh for chunk ${chunkId} (Source: ${source})`);
            updateChunkMesh(chunkX, chunkZ, chunkData);
        } else if (source === 'cache') {
            // If from cache, the mesh should ideally already exist unless unloaded.
             // Ensure mesh exists if it's supposed to be visible (logic handled in updateVisibleChunks)
             // console.log(`Chunk ${chunkId} loaded from cache. Mesh update handled by visibility check.`);
        }
    } else {
        console.error(`Failed to load or generate valid chunk data for ${chunkId}.`);
    }

    // Process the next chunk in the queue almost immediately
    isLoadingChunk = false; // Allow next iteration to start
    if (chunkLoadQueue.size > 0) {
         setTimeout(processChunkQueue, 0); // Yield briefly before processing next
    } else {
        updateLoadingStatus(); // Ensure loading status is hidden if queue is now empty
        // console.log("Chunk queue finished processing.");
    }
}

function updateChunkMesh(chunkX, chunkZ, chunkData) {
    const chunkId = `${chunkX},${chunkZ}`;

     // Remove existing mesh if it exists
     const existingMesh = chunkMeshCache[chunkId];
     if (existingMesh) {
        scene.remove(existingMesh);
        existingMesh.geometry.dispose(); // Dispose old geometry
        delete chunkMeshCache[chunkId];
    }

    const geometry = createChunkGeometry(chunkX, chunkZ, chunkData);

    if (geometry) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { chunkId };
        scene.add(mesh);
        chunkMeshCache[chunkId] = mesh;
        // console.log(`Added/Updated mesh for chunk ${chunkId} with ${geometry.attributes.position.count} vertices.`);
    } else {
         // console.log(`Chunk ${chunkId} resulted in no geometry, mesh not created/updated.`);
    }
}

// Render distance
const renderDistance = 4; // Chunks in each direction

// Store the last player chunk coordinates to avoid unnecessary checks
let lastPlayerChunkX = null;
let lastPlayerChunkZ = null;

function updateVisibleChunks() {
    const playerPos = controls.getObject().position; // Camera position is player position

    const playerChunkX = Math.floor(playerPos.x / chunkSize);
    const playerChunkZ = Math.floor(playerPos.z / chunkSize);

    // Only update if the player has moved to a new chunk
    if (playerChunkX === lastPlayerChunkX && playerChunkZ === lastPlayerChunkZ) {
        return;
    }
     // console.log(`Player moved to chunk ${playerChunkX}, ${playerChunkZ}. Updating visible chunks.`);
    lastPlayerChunkX = playerChunkX;
    lastPlayerChunkZ = playerChunkZ;

    const previouslyVisible = new Set(Object.keys(chunkMeshCache));
    const currentlyNeeded = new Set();

    // Determine needed chunks and queue loading
    for (let x = playerChunkX - renderDistance; x <= playerChunkX + renderDistance; x++) {
        for (let z = playerChunkZ - renderDistance; z <= playerChunkZ + renderDistance; z++) {
            const chunkId = `${x},${z}`;
             currentlyNeeded.add(chunkId);

            // Queue loading only if data isn't loaded locally
            if (!chunks[chunkId]) {
                queueChunkLoad(x, z); // Use the queueing function
            }
            // Mesh creation/update is handled when data is processed or by subscription
        }
    }

     // Unload meshes for chunks that are no longer needed
    previouslyVisible.forEach(chunkId => {
        if (!currentlyNeeded.has(chunkId)) {
            const mesh = chunkMeshCache[chunkId];
            if (mesh) {
                // console.log(`Unloading mesh for chunk: ${chunkId}`);
                scene.remove(mesh);
                mesh.geometry.dispose(); // Dispose geometry when unloading mesh
                delete chunkMeshCache[chunkId];
                // Keep the chunk *data* in `chunks` cache for faster reload if needed
            }
        }
    });

    // Create meshes for chunks that are needed, loaded, but not currently meshed
     currentlyNeeded.forEach(chunkId => {
         if (chunks[chunkId] && !chunkMeshCache[chunkId]) {
             const { chunkX, chunkZ } = getChunkCoordinatesFromId(chunkId);
             // console.log(`Creating mesh for newly visible loaded chunk: ${chunkId}`);
             updateChunkMesh(chunkX, chunkZ, chunks[chunkId]);
         }
     });


    updateLoadingStatus(); // Update UI based on queue length
}

function updateLoadingStatus() {
     if (loadingDiv) {
        const queueSize = chunkLoadQueue.size + (isLoadingChunk ? 1 : 0); // Add 1 if a chunk is actively processing
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

window.addEventListener('mousedown', (event) => {
     if (!controls.isLocked) return;

    raycaster.setFromCamera({ x: 0, y: 0 }, camera); // Raycast from center of screen
    const meshesToIntersect = Object.values(chunkMeshCache);
    if (meshesToIntersect.length === 0) return;

    const intersects = raycaster.intersectObjects(meshesToIntersect, false);

    if (intersects.length > 0) {
        const intersection = intersects[0];
         if (intersection.distance > 6) return; // Max reach distance

        const point = intersection.point;
         // Use the face normal to determine placement/removal side
        const normal = intersection.face.normal.clone(); //.normalize(); // Already normalized?


        let voxelPos;
        if (event.button === 0) { // Left click: Remove block
            // Move slightly *into* the block face before flooring
            voxelPos = getVoxelCoordinates(
                point.x - normal.x * 0.5, // Move half a block unit inwards
                point.y - normal.y * 0.5,
                point.z - normal.z * 0.5
            );
             // console.log("Attempting remove at:", voxelPos);
             modifyBlock(voxelPos.x, voxelPos.y, voxelPos.z, null);
        } else if (event.button === 2) { // Right click: Place block
             // Move slightly *out* from the block face before flooring
             voxelPos = getVoxelCoordinates(
                point.x + normal.x * 0.5, // Move half a block unit outwards
                point.y + normal.y * 0.5,
                point.z + normal.z * 0.5
            );
             // console.log("Attempting place at:", voxelPos, "Type:", selectedBlock);

             // Collision check: Prevent placing inside player's bounding box
            const playerPos = controls.getObject().position;
            const playerMin = { x: playerPos.x - 0.4, y: playerPos.y - playerHeight / 2, z: playerPos.z - 0.4 };
            const playerMax = { x: playerPos.x + 0.4, y: playerPos.y + playerHeight / 2, z: playerPos.z + 0.4 };

             const blockCenter = { x: voxelPos.x + 0.5, y: voxelPos.y + 0.5, z: voxelPos.z + 0.5 };

             // Simple AABB check (block vs player)
            if (blockCenter.x + 0.5 > playerMin.x && blockCenter.x - 0.5 < playerMax.x &&
                blockCenter.y + 0.5 > playerMin.y && blockCenter.y - 0.5 < playerMax.y &&
                blockCenter.z + 0.5 > playerMin.z && blockCenter.z - 0.5 < playerMax.z)
             {
                 console.log("Cannot place block inside player");
                 return;
             }

            modifyBlock(voxelPos.x, voxelPos.y, voxelPos.z, { type: selectedBlock });
        }
    }
});

async function modifyBlock(worldX, worldY, worldZ, newBlockData) {
     // Ensure coordinates are integers
     worldX = Math.floor(worldX);
     worldY = Math.floor(worldY);
     worldZ = Math.floor(worldZ);


     if (worldY < 0) {
         console.log("Cannot modify blocks below Y=0");
         return; // Cannot modify below y=0
     }


    const { chunkX, chunkZ } = getChunkCoordinates(worldX, worldZ);
    const chunkId = `${chunkX},${chunkZ}`;
    const blockKey = getBlockKeyInChunk(worldX, worldY, worldZ);


    let chunkData = chunks[chunkId];
    // If chunk data isn't loaded locally, modification is impossible (shouldn't happen if raycast hit it)
    if (!chunkData) {
        console.error(`Attempted to modify non-loaded chunk: ${chunkId}. This shouldn't happen.`);
        // Maybe try to fetch it? But optimistic update needs immediate data.
         try {
             chunkData = await room.collection(CHUNK_COLLECTION).get(chunkId);
             if (!chunkData) {
                  console.error(`Chunk ${chunkId} not found in DB either.`);
                  return;
             }
             chunks[chunkId] = chunkData; // Cache it
         } catch(e) {
              console.error(`Error fetching chunk ${chunkId} during modification attempt:`, e);
              return;
         }
    }

     // Ensure blocks object exists
     if (!chunkData.blocks) {
        console.warn(`Chunk ${chunkId} loaded without a 'blocks' object. Initializing.`);
        chunkData.blocks = {};
     }

    const existingBlockData = chunkData.blocks[blockKey];
    const existingBlockType = existingBlockData ? blockTypes[existingBlockData.type] : null;


     // --- Pre-modification Checks ---
    // Prevent breaking unbreakable blocks
    if (newBlockData === null && existingBlockType?.unbreakable) {
        console.log("Cannot break unbreakable block.");
        return;
    }
     // Prevent placing the exact same block type again
    if (newBlockData && existingBlockData?.type === newBlockData.type) {
        // console.log("Block of same type already exists.");
        return;
    }
     // Prevent deleting air
     if (newBlockData === null && !existingBlockData) {
        // console.log("Block is already air.");
        return;
    }


    // --- Optimistic Update ---
    const oldBlocksState = { ...chunkData.blocks }; // Shallow copy is enough if block data is simple

    if (newBlockData) {
        chunkData.blocks[blockKey] = newBlockData;
    } else {
        delete chunkData.blocks[blockKey];
    }

    console.log(`Optimistic update: ${newBlockData ? `Placed ${newBlockData.type}` : 'Removed block'} at ${blockKey} in ${chunkId}`);
    updateChunkMesh(chunkX, chunkZ, chunkData); // Update local mesh


     // Determine if neighbor chunks need mesh updates due to boundary changes
     const localX = THREE.MathUtils.euclideanModulo(worldX, chunkSize);
     const localZ = THREE.MathUtils.euclideanModulo(worldZ, chunkSize);
     const neighborsToUpdate = new Set();
     if (localX === 0) neighborsToUpdate.add(`${chunkX - 1},${chunkZ}`);
     if (localX === chunkSize - 1) neighborsToUpdate.add(`${chunkX + 1},${chunkZ}`);
     if (localZ === 0) neighborsToUpdate.add(`${chunkX},${chunkZ - 1}`);
     if (localZ === chunkSize - 1) neighborsToUpdate.add(`${chunkX},${chunkZ + 1}`);


     neighborsToUpdate.forEach((neighborId) => {
         const neighborData = chunks[neighborId];
         // Only update neighbor mesh if its data is loaded and the mesh exists (is visible)
         if (neighborData && chunkMeshCache[neighborId]) {
             // console.log(`Updating neighbor mesh due to boundary change: ${neighborId}`);
             const { chunkX: nx, chunkZ: nz } = getChunkCoordinatesFromId(neighborId);
             updateChunkMesh(nx, nz, neighborData);
         }
     });


    // --- Database Update ---
    try {
        // Send only the updated blocks field
        await room.collection(CHUNK_COLLECTION).update(chunkId, {
            blocks: chunkData.blocks,
        });
        // console.log(`Successfully updated chunk ${chunkId} in DB`);
    } catch (error) {
        console.error(`Failed to update chunk ${chunkId} in DB:`, error);
        // --- Revert Optimistic Update ---
        console.log(`Reverting optimistic update for chunk ${chunkId}`);
        chunkData.blocks = oldBlocksState; // Restore previous block state
        updateChunkMesh(chunkX, chunkZ, chunkData); // Re-render the chunk

         // Revert neighbor meshes if they were updated optimistically
         neighborsToUpdate.forEach((neighborId) => {
             const neighborData = chunks[neighborId];
             if (neighborData && chunkMeshCache[neighborId]) { // Check mesh again
                 console.log(`Reverting neighbor mesh update: ${neighborId}`);
                 const { chunkX: nx, chunkZ: nz } = getChunkCoordinatesFromId(neighborId);
                 // Use neighborData which should be correct (wasn't modified optimistically)
                 updateChunkMesh(nx, nz, neighborData);
             }
         });
    }
}

// Subscribe to chunk updates from other players
room.collection(CHUNK_COLLECTION).subscribe((updatedChunkList) => {
     // console.log(`Received ${updatedChunkList.length} chunk updates from subscription.`);
    updatedChunkList.forEach(dbChunkData => {
        const chunkId = dbChunkData.id;
         if (!dbChunkData.id || !dbChunkData.blocks) {
             console.warn(`Received invalid chunk data from subscription for id: ${chunkId}`);
             return;
         }
        const localChunkData = chunks[chunkId];

        // Simple existence check or deep compare if necessary
        // For now, assume any received update is newer/valid and update if different
        const hasChanged = !localChunkData || JSON.stringify(localChunkData.blocks) !== JSON.stringify(dbChunkData.blocks);

        if (hasChanged) {
             // console.log(`Processing remote update for chunk: ${chunkId}`);
             chunks[chunkId] = dbChunkData; // Update local cache

             const { chunkX, chunkZ } = getChunkCoordinatesFromId(chunkId);

            // Update mesh only if the chunk is currently rendered (in mesh cache)
            if (chunkMeshCache[chunkId]) {
                // console.log(`Updating mesh for remotely modified visible chunk: ${chunkId}`);
                updateChunkMesh(chunkX, chunkZ, dbChunkData);

                 // Check and update visible neighbors because their geometry might change
                 const neighbors = [
                    `${chunkX-1},${chunkZ}`, `${chunkX+1},${chunkZ}`,
                    `${chunkX},${chunkZ-1}`, `${chunkX},${chunkZ+1}`
                 ];
                 neighbors.forEach(neighborId => {
                     // Update neighbor only if its data exists locally AND its mesh exists (is visible)
                     if (chunks[neighborId] && chunkMeshCache[neighborId]) {
                         // console.log(`Updating neighbor mesh ${neighborId} due to remote update in ${chunkId}`);
                         const neighborCoords = getChunkCoordinatesFromId(neighborId);
                         updateChunkMesh(neighborCoords.chunkX, neighborCoords.chunkZ, chunks[neighborId]);
                     }
                 });
            }
            // else { console.log(`Remote update for non-visible chunk ${chunkId}, cached data updated.`); }
        }
    });
});

function getChunkCoordinatesFromId(chunkId) {
     const parts = chunkId.split(',');
     // Basic validation
     if (parts.length !== 2 || isNaN(parseInt(parts[0], 10)) || isNaN(parseInt(parts[1], 10))) {
         console.error(`Invalid chunkId format: ${chunkId}`);
         return { chunkX: 0, chunkZ: 0 }; // Default or null might be better
     }
     return { chunkX: parseInt(parts[0], 10), chunkZ: parseInt(parts[1], 10) };
}

// Block Selector UI
function setupBlockSelector() {
     blockSelectorDiv.innerHTML = ''; // Clear existing
    blockNames.forEach(name => {
         // Skip bedrock in selector
         if (name === 'bedrock') return;

        const option = document.createElement('div');
        option.classList.add('block-option');
        const blockInfo = blockTypes[name];
         if (blockInfo.color) {
             option.style.backgroundColor = `#${new THREE.Color(blockInfo.color).getHexString()}`;
         } else {
             option.style.backgroundColor = '#ffffff'; // Fallback color
             option.textContent = '?'; // Indicate missing color
         }

        option.title = name;
        option.dataset.blockType = name;
        option.addEventListener('click', () => {
            selectedBlock = name;
            updateSelectorUI();
        });
        blockSelectorDiv.appendChild(option);
    });
    updateSelectorUI(); // Highlight default selection
}

function updateSelectorUI() {
    const options = blockSelectorDiv.querySelectorAll('.block-option');
    options.forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.blockType === selectedBlock);
    });
}

// Collision Detection Raycasters
const collisionRays = [
    new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, playerHeight / 2 + 0.1), // Down
    // Add rays for horizontal collision later if needed
];

function checkCollisions(delta) {
     if (!controls.isLocked) return; // Movement logic only when locked

     const playerPosition = controls.getObject().position; // Camera position is head position
     const playerVelocity = movement.velocity;
     const onGroundPrev = movement.onGround;
     movement.onGround = false;
     const meshesToIntersect = Object.values(chunkMeshCache);

     // --- Ground Check ---
     const downRay = collisionRays[0];
     downRay.ray.origin.copy(playerPosition);
     // Start ray slightly below head height to avoid hitting ceiling first
     // And ensure it checks from near the center of the player model downwards
     downRay.ray.origin.y -= (playerHeight / 2) - 0.1; // Start check near feet level
     downRay.far = 0.2; // Check just below feet

     if (meshesToIntersect.length > 0) {
         const groundIntersects = downRay.intersectObjects(meshesToIntersect, false);
         if (groundIntersects.length > 0) {
             // console.log('Ground intersect distance:', groundIntersects[0].distance);
             movement.onGround = true;
             // Snap player up slightly if slightly below ground (e.g., due to float precision)
             // if (groundIntersects[0].distance < 0.1) { // This threshold might need tuning
             //    playerPosition.y += (0.1 - groundIntersects[0].distance);
             //}
         }
     }

     // Apply gravity if not on ground OR if moving upwards (allows jumping off ground)
     if (!movement.onGround || playerVelocity.y > 0) {
         playerVelocity.y += gravity * delta;
     } else {
         // On ground and not moving up: stop vertical velocity
         playerVelocity.y = 0;
     }

     // --- Jumping ---
     if (movement.jump && onGroundPrev) { // Can only jump if was on ground previously
         playerVelocity.y = Math.sqrt(2 * jumpHeight * Math.abs(gravity)); // Calculate jump velocity
         movement.onGround = false; // Ensure not flagged as on ground immediately after jump
     }
     movement.jump = false; // Consume jump input

     // --- Horizontal Movement & Damping ---
     // Apply damping (friction)
     const dampingFactor = Math.pow(0.001, delta); // Exponential damping based on delta
     playerVelocity.x *= dampingFactor;
     playerVelocity.z *= dampingFactor;

     // Calculate movement direction based on input and camera orientation
     movement.direction.z = Number(movement.forward) - Number(movement.backward);
     movement.direction.x = Number(movement.right) - Number(movement.left); // Note: Right is positive X
     movement.direction.normalize(); // Ensure consistent speed regardless of diagonal movement

     const currentSpeed = playerSpeed * (movement.onGround ? 1 : 0.5); // Less air control

     // Get camera direction (ignore vertical component)
     const cameraDirection = new THREE.Vector3();
     camera.getWorldDirection(cameraDirection);
     cameraDirection.y = 0;
     cameraDirection.normalize();

     const rightDirection = new THREE.Vector3().crossVectors(camera.up, cameraDirection).normalize();

     // Calculate velocity change based on input direction relative to camera
     const moveVelocity = new THREE.Vector3();
     moveVelocity.add(cameraDirection.multiplyScalar(movement.direction.z));
     moveVelocity.add(rightDirection.multiplyScalar(movement.direction.x));
     moveVelocity.normalize().multiplyScalar(currentSpeed); // Ensure consistent speed

     // Apply acceleration
     playerVelocity.x += moveVelocity.x * delta * 10; // Adjust multiplier as needed for responsiveness
     playerVelocity.z += moveVelocity.z * delta * 10;


     // --- Wall Collision (Simplified Placeholder) ---
     // TODO: Implement proper collision detection and response with walls

     // --- Apply Movement ---
     // Use controls.moveRight and moveForward which handle camera rotation
     // Need to calculate the *intended movement vector* based on velocity
     const deltaX = playerVelocity.x * delta;
     const deltaZ = playerVelocity.z * delta;

     // controls.moveRight uses camera's local X, controls.moveForward uses camera's local Z (view direction)
     // We need to translate world-space velocity change into camera-local movement commands.
     // This is tricky. Let's directly manipulate position for now, assuming controls object is added.
     const forwardVector = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
     const rightVector = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

     playerPosition.add(forwardVector.multiplyScalar(deltaZ)); // Incorrect: Should use velocity relative to world/input
     playerPosition.add(rightVector.multiplyScalar(deltaX)); // Incorrect


     // --- Correct position update using velocity ---
      playerPosition.x += playerVelocity.x * delta;
      playerPosition.z += playerVelocity.z * delta;
      playerPosition.y += playerVelocity.y * delta; // Apply vertical movement


     // --- World Bounds Check ---
     if (playerPosition.y < -50) { // Increased fall distance before respawn
         console.log("Player fell out of world, respawning...");
         playerPosition.set(5, 70, 5); // Respawn high up near start
         playerVelocity.set(0, 0, 0);
         movement.onGround = false;
         // Don't clear all chunks on respawn, just recenter view
         lastPlayerChunkX = null; // Force chunk check on next frame
         lastPlayerChunkZ = null;
         updateVisibleChunks(); // Trigger chunk loading around new position
     }

     // --- Send Presence Update ---
     // Throttle updates
     if (Date.now() - lastPresenceUpdate > 100) { // Send updates ~10 times/sec
        // Send position of the player's feet for rendering consistency
        const feetPosition = { x: playerPosition.x, y: playerPosition.y - playerHeight / 2, z: playerPosition.z };
        // Send camera rotation (use quaternion for better accuracy if needed)
        const currentRotation = { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z };

        // Only send if position or rotation actually changed significantly
        const posChanged = !lastSentPosition || Math.abs(feetPosition.x - lastSentPosition.x) > 0.01 || Math.abs(feetPosition.y - lastSentPosition.y) > 0.01 || Math.abs(feetPosition.z - lastSentPosition.z) > 0.01;
        const rotChanged = !lastSentRotation || Math.abs(currentRotation.x - lastSentRotation.x) > 0.01 || Math.abs(currentRotation.y - lastSentRotation.y) > 0.01; // Only check yaw for now maybe

        if (posChanged || rotChanged) {
             room.updatePresence({
                position: feetPosition,
                rotation: currentRotation
            });
            lastPresenceUpdate = Date.now();
            lastSentPosition = feetPosition;
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
// Perform initial chunk check immediately
console.log("Performing initial chunk load...");
updateVisibleChunks(); // Request initial chunks based on starting position


// Animation loop
function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1); // Cap delta

    // Update player physics and movement ONLY when pointer is locked
    if (controls.isLocked) {
        checkCollisions(delta);
    }

     // Update visible chunks based on camera position regardless of lock state
     // Throttle this check slightly to avoid running every single frame
     // updateVisibleChunks(); // Removed throttling for now, run every frame

     // Run the chunk visibility check less frequently?
     // Maybe only when the player moves significantly or periodically?
     // For now, running it based on chunk change (inside updateVisibleChunks) is probably best.
     // We need a way to trigger updateVisibleChunks periodically or when needed.
     // Let's rely on the check inside it for now.
     // We still need to *call* it though.
     updateVisibleChunks(); // Needs to be called to check if player moved chunks

    // Update other players (TODO)

    // Render the scene
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