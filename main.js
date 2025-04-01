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
camera.position.set(0, 80, 0); // Start higher up

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const loadingDiv = document.getElementById('loading');
const blockSelectorDiv = document.getElementById('block-selector');

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
    grass: { top: 0, bottom: 2, side: 1 },
    dirt: { top: 2, bottom: 2, side: 2 },
    stone: { top: 3, bottom: 3, side: 3 },
    wood: { top: 4, bottom: 4, side: 5 },
    leaves: { top: 6, bottom: 6, side: 6 },
    sand: { top: 7, bottom: 7, side: 7},
    // Add more block types here
};
const blockNames = Object.keys(blockTypes);
let selectedBlock = blockNames[0]; // Default selection

// Texture loading
const textureLoader = new THREE.TextureLoader();
const texture = textureLoader.load('textures.png');
texture.magFilter = THREE.NearestFilter;
texture.minFilter = THREE.NearestFilter;

const material = new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide });

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
        }
    }
    return blocks;
}


function getBlock(worldX, worldY, worldZ) {
    const { chunkX, chunkZ } = getChunkCoordinates(worldX, worldZ);
    const chunkId = `${chunkX},${chunkZ}`;
    const chunk = chunks[chunkId];
    if (!chunk || !chunk.blocks) return null;

    const blockKey = getBlockKeyInChunk(worldX, worldY, worldZ);
    return chunk.blocks[blockKey];
}


// Create chunk geometry
function createChunkGeometry(chunkX, chunkZ, chunkData) {
    const chunkId = `${chunkX},${chunkZ}`;
    const chunkBlocks = chunkData.blocks || {};
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let index = 0;

    const startX = chunkX * chunkSize;
    const startZ = chunkZ * chunkSize;

    for (const key in chunkBlocks) {
        const [lx, ly, lz] = key.split(',').map(Number);
        const block = chunkBlocks[key];
        if (!block) continue;

        const blockInfo = blockTypes[block.type];
        if (!blockInfo) {
             console.warn(`Unknown block type: ${block.type} at ${key}`);
             continue;
        }


        const worldX = startX + lx;
        const worldY = ly;
        const worldZ = startZ + lz;

        // Check neighbors
        const neighbors = {
            nx: getBlock(worldX - 1, worldY, worldZ),
            px: getBlock(worldX + 1, worldY, worldZ),
            ny: getBlock(worldX, worldY - 1, worldZ),
            py: getBlock(worldX, worldY + 1, worldZ),
            nz: getBlock(worldX, worldY, worldZ - 1),
            pz: getBlock(worldX, worldY, worldZ + 1),
        };

        const faces = [
            { dir: [-1, 0, 0], corners: [ [0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1] ], uvRow: blockInfo.side, neighbor: neighbors.nx }, // nx
            { dir: [ 1, 0, 0], corners: [ [1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0] ], uvRow: blockInfo.side, neighbor: neighbors.px }, // px
            { dir: [ 0,-1, 0], corners: [ [1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0] ], uvRow: blockInfo.bottom, neighbor: neighbors.ny }, // ny
            { dir: [ 0, 1, 0], corners: [ [0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0] ], uvRow: blockInfo.top, neighbor: neighbors.py }, // py
            { dir: [ 0, 0,-1], corners: [ [1, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 0] ], uvRow: blockInfo.side, neighbor: neighbors.nz }, // nz
            { dir: [ 0, 0, 1], corners: [ [0, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 1] ], uvRow: blockInfo.side, neighbor: neighbors.pz }, // pz
        ];

        for (const { dir, corners, uvRow, neighbor } of faces) {
             // Only render face if neighbor is air or transparent block (implement transparency check later)
            if (!neighbor) {
                const ndx = positions.length / 3;
                for (const pos of corners) {
                    positions.push(pos[0] + worldX, pos[1] + worldY, pos[2] + worldZ);
                    normals.push(...dir);
                }

                const u = (uvRow % 4) * (tileTextureWidth / 4);
                const v = Math.floor(uvRow / 4) * (tileTextureHeight / 1); // Assuming 1 row of textures for now

                const u0 = u / tileTextureWidth;
                const v0 = v / tileTextureHeight;
                const u1 = (u + tileTextureWidth / 4) / tileTextureWidth;
                const v1 = (v + tileTextureHeight / 1) / tileTextureHeight;

                uvs.push(u0, v1, u0, v0, u1, v1, u1, v0); // Adjusted UV mapping

                indices.push(
                    ndx, ndx + 1, ndx + 2,
                    ndx + 2, ndx + 1, ndx + 3,
                );
                 index += 6;
            }
        }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere(); // Important for frustum culling

    chunkGeometryCache[chunkId] = geometry;
    return geometry;
}


// Function to load or generate a chunk
async function loadOrGenerateChunk(chunkX, chunkZ) {
    const chunkId = `${chunkX},${chunkZ}`;
    if (chunks[chunkId] || chunkLoadQueue.includes(chunkId)) {
        return; // Already loaded, loading, or queued
    }

    chunkLoadQueue.push(chunkId);
    processChunkQueue(); // Start processing if not already
}


async function processChunkQueue() {
    if (isLoadingChunk || chunkLoadQueue.length === 0) {
        return;
    }
    isLoadingChunk = true;

    const chunkId = chunkLoadQueue.shift();
    const [chunkX, chunkZ] = chunkId.split(',').map(Number);

    // Try to get from DB
    let chunkData = await room.collection(CHUNK_COLLECTION).get(chunkId);

    if (!chunkData) {
        // Generate and save to DB
        const generatedBlocks = generateChunkData(chunkX, chunkZ);
        try {
            chunkData = await room.collection(CHUNK_COLLECTION).create({
                id: chunkId, // Use chunkId as the DB id
                chunkX: chunkX,
                chunkZ: chunkZ,
                blocks: generatedBlocks,
            });
            console.log(`Generated and saved chunk: ${chunkId}`);
        } catch (e) {
            // Handle potential race condition if another client created it first
             if (e.message.includes('already exists')) {
                 console.log(`Chunk ${chunkId} already exists, fetching.`);
                 chunkData = await room.collection(CHUNK_COLLECTION).get(chunkId);
             } else {
                 console.error("Error creating chunk:", e);
                 isLoadingChunk = false;
                 processChunkQueue(); // Try next chunk
                 return;
             }
        }

    } else {
        console.log(`Loaded chunk from DB: ${chunkId}`);
    }


    if (chunkData && chunkData.blocks) {
        chunks[chunkId] = chunkData;
        updateChunkMesh(chunkX, chunkZ, chunkData);
    } else {
        console.error(`Failed to load or generate chunk data for ${chunkId}`);
    }


    isLoadingChunk = false;
    // Process next chunk in the queue after a short delay to prevent flooding
    setTimeout(processChunkQueue, 10);
}


function updateChunkMesh(chunkX, chunkZ, chunkData) {
    const chunkId = `${chunkX},${chunkZ}`;

     // Remove existing mesh if it exists
     if (chunkMeshCache[chunkId]) {
        scene.remove(chunkMeshCache[chunkId]);
        chunkMeshCache[chunkId].geometry.dispose(); // Dispose old geometry
        delete chunkMeshCache[chunkId];
        delete chunkGeometryCache[chunkId]; // Clear geometry cache as well
    }


    const geometry = createChunkGeometry(chunkX, chunkZ, chunkData);
    if (geometry.attributes.position.count > 0) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { chunkId }; // Store chunkId for potential future use
        scene.add(mesh);
        chunkMeshCache[chunkId] = mesh;
    } else {
         console.log(`Chunk ${chunkId} has no geometry, skipping mesh creation.`);
    }
}


// Render distance
const renderDistance = 5; // Chunks in each direction

function updateVisibleChunks() {
    const playerChunkX = Math.floor(controls.getObject().position.x / chunkSize);
    const playerChunkZ = Math.floor(controls.getObject().position.z / chunkSize);

    const previouslyVisible = new Set(Object.keys(chunkMeshCache));
    const currentlyVisible = new Set();

    for (let x = playerChunkX - renderDistance; x <= playerChunkX + renderDistance; x++) {
        for (let z = playerChunkZ - renderDistance; z <= playerChunkZ + renderDistance; z++) {
            const chunkId = `${x},${z}`;
             currentlyVisible.add(chunkId);
            if (!chunkMeshCache[chunkId] && !chunkLoadQueue.includes(chunkId) && !chunks[chunkId]) {
                loadOrGenerateChunk(x, z);
            }
        }
    }

     // Remove chunks that are no longer visible
    previouslyVisible.forEach(chunkId => {
        if (!currentlyVisible.has(chunkId)) {
            if (chunkMeshCache[chunkId]) {
                scene.remove(chunkMeshCache[chunkId]);
                 // Don't dispose geometry immediately, might be needed again soon
                 // chunkMeshCache[chunkId].geometry.dispose();
                delete chunkMeshCache[chunkId];
                 // Don't delete from main `chunks` data, just unload mesh
            }
        }
    });

     if (loadingDiv) {
        if (chunkLoadQueue.length > 0 || isLoadingChunk) {
            loadingDiv.style.display = 'block';
            loadingDiv.textContent = `Loading Chunks... (${chunkLoadQueue.length} remaining)`;
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
    const intersects = raycaster.intersectObjects(Object.values(chunkMeshCache), false);


    if (intersects.length > 0) {
        const intersection = intersects[0];
        const point = intersection.point;
        const normal = intersection.face.normal;


        // Calculate voxel coordinates based on click type
        let voxelPos;
        if (event.button === 0) { // Left click: Remove block
            voxelPos = getVoxelCoordinates(
                point.x - normal.x * 0.01,
                point.y - normal.y * 0.01,
                point.z - normal.z * 0.01
            );
             modifyBlock(voxelPos.x, voxelPos.y, voxelPos.z, null); // Remove block
        } else if (event.button === 2) { // Right click: Place block
             voxelPos = getVoxelCoordinates(
                point.x + normal.x * 0.01,
                point.y + normal.y * 0.01,
                point.z + normal.z * 0.01
            );
             // Basic collision check: Don't place block inside player
            const playerPos = controls.getObject().position;
            const playerVoxel = getVoxelCoordinates(playerPos.x, playerPos.y, playerPos.z);
             const playerVoxelHead = getVoxelCoordinates(playerPos.x, playerPos.y + playerHeight - 0.1, playerPos.z); // Check head pos


            if ( (voxelPos.x === playerVoxel.x && voxelPos.y === playerVoxel.y && voxelPos.z === playerVoxel.z) ||
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
     if (worldY <= 0) return; // Cannot modify below y=0 (bedrock level)


    const { chunkX, chunkZ } = getChunkCoordinates(worldX, worldZ);
    const chunkId = `${chunkX},${chunkZ}`;
    const blockKey = getBlockKeyInChunk(worldX, worldY, worldZ);


    const chunkData = chunks[chunkId];
    if (!chunkData) {
        console.error(`Attempted to modify non-loaded chunk: ${chunkId}`);
        return;
    }

     // Check if block is unbreakable
    const existingBlock = chunkData.blocks[blockKey];
    if (existingBlock && existingBlock.unbreakable && newBlock === null) {
        console.log("Cannot break unbreakable block");
        return;
    }


    // Optimistic update
    const oldBlocks = { ...chunkData.blocks }; // Clone for potential revert
    if (newBlock) {
        chunkData.blocks[blockKey] = newBlock;
    } else {
        delete chunkData.blocks[blockKey];
    }
    updateChunkMesh(chunkX, chunkZ, chunkData); // Update local mesh immediately


     // Update neighbor chunks if modification is on a border
     const localX = THREE.MathUtils.euclideanModulo(Math.floor(worldX), chunkSize);
     const localZ = THREE.MathUtils.euclideanModulo(Math.floor(worldZ), chunkSize);


     const neighborsToUpdate = [];
     if (localX === 0) neighborsToUpdate.push({ cx: chunkX - 1, cz: chunkZ });
     if (localX === chunkSize - 1) neighborsToUpdate.push({ cx: chunkX + 1, cz: chunkZ });
     if (localZ === 0) neighborsToUpdate.push({ cx: chunkX, cz: chunkZ - 1 });
     if (localZ === chunkSize - 1) neighborsToUpdate.push({ cx: chunkX, cz: chunkZ + 1 });


     neighborsToUpdate.forEach(({ cx, cz }) => {
         const neighborId = `${cx},${cz}`;
         if (chunks[neighborId]) {
             updateChunkMesh(cx, cz, chunks[neighborId]);
         }
     });


    // Update database
    try {
        await room.collection(CHUNK_COLLECTION).update(chunkId, {
            blocks: chunkData.blocks, // Send the entire updated blocks object
        });
        console.log(`Updated chunk ${chunkId} in DB`);
    } catch (error) {
        console.error(`Failed to update chunk ${chunkId} in DB:`, error);
        // Revert optimistic update
        chunkData.blocks = oldBlocks;
        updateChunkMesh(chunkX, chunkZ, chunkData);
         neighborsToUpdate.forEach(({ cx, cz }) => {
             const neighborId = `${cx},${cz}`;
             if (chunks[neighborId]) {
                 updateChunkMesh(cx, cz, chunks[neighborId]);
             }
         });
    }
}


// Subscribe to chunk updates from other players
room.collection(CHUNK_COLLECTION).subscribe((updatedChunkList) => {
    // `getList` returns newest first, we don't necessarily need an order here
    // but process the updates
    updatedChunkList.forEach(dbChunkData => {
        const chunkId = dbChunkData.id;
        if (chunks[chunkId] && JSON.stringify(chunks[chunkId].blocks) !== JSON.stringify(dbChunkData.blocks)) {
             console.log(`Received update for chunk: ${chunkId}`);
             chunks[chunkId] = dbChunkData; // Update local cache


             // Check if the chunk is currently rendered before updating mesh
            if (chunkMeshCache[chunkId]) {
                const { chunkX, chunkZ } = getChunkCoordinatesFromId(chunkId);
                updateChunkMesh(chunkX, chunkZ, dbChunkData);


                 // Also update neighbors if they are rendered
                 const neighbors = [
                    `${chunkX-1},${chunkZ}`, `${chunkX+1},${chunkZ}`,
                    `${chunkX},${chunkZ-1}`, `${chunkX},${chunkZ+1}`
                 ];
                 neighbors.forEach(neighborId => {
                     if (chunkMeshCache[neighborId]) {
                         const {chunkX: nx, chunkZ: nz} = getChunkCoordinatesFromId(neighborId);
                         if(chunks[neighborId]) { // Make sure neighbor data exists
                             updateChunkMesh(nx, nz, chunks[neighborId]);
                         }
                     }
                 });
            }
        } else if (!chunks[chunkId]) {
             // Another player might have created a chunk we need
             chunks[chunkId] = dbChunkData;
             // Check if we should render it now based on current visibility
            const { chunkX, chunkZ } = getChunkCoordinatesFromId(chunkId);
            const playerChunkX = Math.floor(controls.getObject().position.x / chunkSize);
            const playerChunkZ = Math.floor(controls.getObject().position.z / chunkSize);
             if (Math.abs(chunkX - playerChunkX) <= renderDistance && Math.abs(chunkZ - playerChunkZ) <= renderDistance) {
                 if (!chunkMeshCache[chunkId]) { // Avoid double rendering if updateChunkMesh was called elsewhere
                     updateChunkMesh(chunkX, chunkZ, dbChunkData);
                 }
             }
        }
    });
});

function getChunkCoordinatesFromId(chunkId) {
     const [chunkX, chunkZ] = chunkId.split(',').map(Number);
     return { chunkX, chunkZ };
}

// Multiplayer Presence Setup
const playerMeshes = {};

function updatePlayerMesh(clientId, data) {
    let mesh = playerMeshes[clientId];
    if (!mesh) {
        // Simple capsule for player representation
        const geometry = new THREE.CapsuleGeometry(0.4, playerHeight - 0.8, 4, 8); // radius, height, capSegments, radialSegments
        const material = new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff });
        mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        scene.add(mesh);
        playerMeshes[clientId] = mesh;
        console.log(`Added mesh for player: ${clientId}`);
    }

    if (data && data.position) {
         // Adjust position slightly upwards because capsule origin is at the center
         mesh.position.set(data.position.x, data.position.y + (playerHeight / 2), data.position.z);
    }
    if (data && data.rotation) {
        // Apply rotation - assuming rotation is Euler YXZ for FPS controls
        // We only care about the Y rotation for the body typically
         mesh.rotation.set(0, data.rotation.y, 0);
    }
}


function removePlayerMesh(clientId) {
    const mesh = playerMeshes[clientId];
    if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        delete playerMeshes[clientId];
         console.log(`Removed mesh for player: ${clientId}`);
    }
}

// Subscribe to presence updates
room.subscribePresence((presence) => {
    const allClientIds = new Set(Object.keys(presence));

    // Update existing or add new players
    for (const clientId in presence) {
        if (clientId === room.clientId) continue; // Don't render self

        const data = presence[clientId];
        if (!data || !data.position) {
             // Player might have connected but not sent position yet, or disconnected abruptly
             if (playerMeshes[clientId]) {
                 removePlayerMesh(clientId);
             }
             continue;
         }

        updatePlayerMesh(clientId, data);
    }

    // Remove players who are no longer present
    for (const existingClientId in playerMeshes) {
        if (!allClientIds.has(existingClientId)) {
            removePlayerMesh(existingClientId);
        }
    }
});


// Block Selector UI
function setupBlockSelector() {
    blockNames.forEach(name => {
        const option = document.createElement('div');
        option.classList.add('block-option');
        option.style.background = `url(textures.png)`; // Use the main texture sheet

        const blockInfo = blockTypes[name];
        const tileIndex = blockInfo.side; // Use the side texture for the preview
        const tilesPerRow = 4;
        const tileSizePx = 64; // Assuming texture is 256x64, each tile is 64x64

        const xOffset = (tileIndex % tilesPerRow) * tileSizePx;
        const yOffset = Math.floor(tileIndex / tilesPerRow) * tileSizePx;

        option.style.backgroundPosition = `-${xOffset}px -${yOffset}px`;
        option.style.backgroundSize = `${tileTextureWidth}px ${tileTextureHeight}px`; // Scale appropriately if needed

        option.dataset.blockType = name;
        option.addEventListener('click', () => {
            selectedBlock = name;
            updateSelectorUI();
        });
        blockSelectorDiv.appendChild(option);
    });
    updateSelectorUI();
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
const collisionRays = [
     // Forward, backward, left, right at feet and head level
     new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 0, 0.5), // Forward foot
     new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0, 0.5),  // Backward foot
     new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(-1, 0, 0), 0, 0.5), // Left foot
     new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 0, 0.5),  // Right foot
     new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 0, 0.5), // Forward head
     new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0, 0.5),  // Backward head
     new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(-1, 0, 0), 0, 0.5), // Left head
     new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), 0, 0.5),  // Right head
];


function checkCollisions(delta) {
     const playerPosition = controls.getObject().position;
     const onGroundPrev = movement.onGround;
     movement.onGround = false;


     // --- Ground Check ---
     downRaycaster.ray.origin.copy(playerPosition);
     const groundIntersects = downRaycaster.intersectObjects(Object.values(chunkMeshCache), false);
     if (groundIntersects.length > 0) {
         const distanceToGround = groundIntersects[0].distance;
         if (distanceToGround <= playerHeight / 2 + 0.1) {
             movement.onGround = true;
             // Snap to ground if slightly above
             if (movement.velocity.y < 0) {
                playerPosition.y -= (distanceToGround - playerHeight / 2);
                 movement.velocity.y = 0;
             }
         }
     }


     // Apply gravity if not on ground
     if (!movement.onGround) {
         movement.velocity.y += gravity * delta;
     } else {
         // Reset downward velocity if grounded
         movement.velocity.y = Math.max(0, movement.velocity.y);
     }


     // --- Jumping ---
     if (movement.jump) {
         if (movement.onGround) {
             // Calculate jump velocity needed to reach jumpHeight
             movement.velocity.y = Math.sqrt(2 * jumpHeight * Math.abs(gravity));
         }
         movement.jump = false; // Consume jump impulse
     }


     // --- Horizontal Movement & Collision ---
     // Reset velocity influencing factors
     movement.velocity.x -= movement.velocity.x * 10.0 * delta; // Damping
     movement.velocity.z -= movement.velocity.z * 10.0 * delta; // Damping


     movement.direction.z = Number(movement.forward) - Number(movement.backward);
     movement.direction.x = Number(movement.left) - Number(movement.right);
     movement.direction.normalize(); // Ensure consistent speed in all directions


     const currentSpeed = playerSpeed * (movement.onGround ? 1 : 0.5); // Slower air control


     if (movement.forward || movement.backward) movement.velocity.z -= movement.direction.z * currentSpeed * delta;
     if (movement.left || movement.right) movement.velocity.x -= movement.direction.x * currentSpeed * delta;


     // Get camera direction for movement
     const cameraDirection = new THREE.Vector3();
     controls.getDirection(cameraDirection);
     const rightDirection = new THREE.Vector3().crossVectors(camera.up, cameraDirection).normalize();


     const moveForward = new THREE.Vector3(cameraDirection.x, 0, cameraDirection.z).normalize();
     const moveRight = new THREE.Vector3(rightDirection.x, 0, rightDirection.z).normalize();


     const moveVector = new THREE.Vector3();
     moveVector.addScaledVector(moveForward, -movement.velocity.z); // Forward/Backward
     moveVector.addScaledVector(moveRight, -movement.velocity.x); // Left/Right


     // --- Collision Detection during Movement ---
     const originalPosition = playerPosition.clone();
     const tempPosition = playerPosition.clone();


      // Move X first, check collision
     tempPosition.x += moveVector.x;
     if (checkHorizontalCollision(tempPosition, moveVector.x, 0)) {
         moveVector.x = 0; // Stop x movement if collision
     }


      // Move Z next, check collision
     tempPosition.x = originalPosition.x; // Reset X for Z check
     tempPosition.z += moveVector.z;
     if (checkHorizontalCollision(tempPosition, 0, moveVector.z)) {
         moveVector.z = 0; // Stop z movement if collision
     }


      // Apply final X and Z movement
     controls.moveRight(-moveVector.x); // Uses camera's right internally
     controls.moveForward(-moveVector.z); // Uses camera's forward internally


     // Apply Y movement (gravity/jump) - check vertical collision
     const verticalMove = movement.velocity.y * delta;
     tempPosition.copy(controls.getObject().position); // Get current XZ pos
     tempPosition.y += verticalMove;


     if (checkVerticalCollision(tempPosition, verticalMove)) {
         movement.velocity.y = 0; // Stop vertical movement
         // Adjust position to just touch the obstacle
         // This part needs refinement based on collision point
     } else {
        controls.getObject().position.y += verticalMove;
     }


     // Send presence update
     if (Date.now() - lastPresenceUpdate > 50) { // Limit update rate
        room.updatePresence({
            position: { x: playerPosition.x, y: playerPosition.y - playerHeight/2 , z: playerPosition.z }, // Send base position
            rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z } // Send camera rotation
        });
        lastPresenceUpdate = Date.now();
    }
}


function checkHorizontalCollision(testPosition, moveX, moveZ) {
    const playerHalfHeight = playerHeight / 2;
     const collisionDistance = 0.45; // Slightly less than player radius


     for (let i = 0; i < 8; i++) { // Check all 8 horizontal rays
         const ray = collisionRays[i];
         const isHeadLevel = i >= 4;
         const originYOffset = isHeadLevel ? playerHalfHeight - 0.1 : -playerHalfHeight + 0.1; // Check near top and bottom


         ray.ray.origin.set(testPosition.x, testPosition.y + originYOffset, testPosition.z);


         // Set direction based on ray index (simplified)
         if (i % 4 === 0) ray.ray.direction.set(0, 0, -1); // Forward
         else if (i % 4 === 1) ray.ray.direction.set(0, 0, 1); // Backward
         else if (i % 4 === 2) ray.ray.direction.set(-1, 0, 0); // Left
         else if (i % 4 === 3) ray.ray.direction.set(1, 0, 0); // Right


         // Only check rays relevant to the movement direction (optimization)
         if ((moveX > 0 && i % 4 !== 3) && (moveX < 0 && i % 4 !== 2) &&
             (moveZ > 0 && i % 4 !== 1) && (moveZ < 0 && i % 4 !== 0)) {
             // continue; // This logic needs refinement - check relevant directions only
         }


         ray.far = collisionDistance;
         const intersects = ray.intersectObjects(Object.values(chunkMeshCache), false);


         if (intersects.length > 0 && intersects[0].distance < collisionDistance) {
             console.log("Horizontal collision detected!");
             return true; // Collision detected
         }
     }
     return false; // No collision
}


function checkVerticalCollision(testPosition, moveY) {
    // Simplified vertical check (using the ground check raycaster logic)
    if (moveY < 0) { // Moving down
        downRaycaster.ray.origin.copy(testPosition);
         downRaycaster.far = playerHeight / 2 + 0.1;
        const intersects = downRaycaster.intersectObjects(Object.values(chunkMeshCache), false);
        if (intersects.length > 0 && intersects[0].distance < playerHeight / 2) {
            // Collision below
            // Adjust position to rest on the surface
             controls.getObject().position.y = intersects[0].point.y + playerHeight / 2;
             console.log("Vertical collision below");
             return true;
        }
    } else if (moveY > 0) { // Moving up
         const upRaycaster = new THREE.Raycaster(testPosition, new THREE.Vector3(0, 1, 0), 0, playerHeight / 2 + 0.1);
         upRaycaster.ray.origin.y -= playerHeight / 2; // Start from feet
         const intersects = upRaycaster.intersectObjects(Object.values(chunkMeshCache), false);
         if (intersects.length > 0 && intersects[0].distance < playerHeight / 2 + moveY) {
             // Collision above (head bump)
             // Adjust position just below the obstacle
             controls.getObject().position.y = intersects[0].point.y - playerHeight / 2 - 0.01;
             console.log("Vertical collision above");
             return true;
         }
    }


    return false; // No vertical collision
}



let lastPresenceUpdate = 0;
const clock = new THREE.Clock();

// Initial setup
setupBlockSelector();
updateVisibleChunks(); // Initial chunk load


// Animation loop
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();


    if (controls.isLocked) {
        checkCollisions(delta); // Update player physics and movement
        updateVisibleChunks(); // Load/unload chunks based on player position
    }


    renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start the game loop
animate();

