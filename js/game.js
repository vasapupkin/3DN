import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';
// Remove this line: import SimplexNoise from 'simplex-noise';

class Game {
    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x87CEEB); // Sky blue color
        this.groundSize = 1000; // Increase ground size
        document.body.appendChild(this.renderer.domElement);

        this.world = new CANNON.World({
            gravity: new CANNON.Vec3(0, -9.82, 0)
        });

        this.objects = [];
        this.viking = null;
        this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.isDragging = false;
        this.trees = [];
        this.lastLegSwing = 0;
        this.chunkSize = 100;
        this.renderDistance = 2;
        this.chunks = new Map();
        this.currentChunk = { x: 0, z: 0 };
        this.cameraOffset = new THREE.Vector3(0, 10, 20);
        this.moveDirection = new THREE.Vector3();
        this.currentAnimation = null;
        this.isMoving = false;
        this.movementSpeed = 0.3;
        this.setupControls();

        this.loader = new GLTFLoader();
        this.mixer = null;
        this.animations = {};
        this.clock = new THREE.Clock();

        this.isLoading = true;
        this.walkAction = null;
        this.isWalking = false;
        this.armatureAction = null;
        this.isArmatureActive = false;
        this.animationMixer = null;
        this.vikingInitialPosition = new THREE.Vector3();
        this.vikingInitialRotation = new THREE.Quaternion();
        this.treeModel = null;

        // Initialize this.p for the noise function
        this.p = new Uint8Array(512);
        for (let i = 0; i < 256; i++) this.p[i] = i;
        for (let i = 0; i < 255; i++) {
            const r = i + ~~(Math.random() * (256 - i));
            const aux = this.p[i];
            this.p[i] = this.p[r];
            this.p[r] = aux;
        }
        for (let i = 256; i < 512; i++) this.p[i] = this.p[i & 255];

        // Move these method calls to the end of the constructor
        this.init();
        this.createTerrain();
        this.loadTreeModel(); // This will load the new tree model and place trees
    }

    init() {
        console.log("Initializing game...");
        // Remove initial camera positioning from here

        // Adjust lighting
        const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);

        // Create a larger, more natural-looking ground
        const groundSize = 1000;
        const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
        const groundTexture = new THREE.TextureLoader().load('path/to/grass_texture.jpg');
        groundTexture.wrapS = groundTexture.wrapT = THREE.RepeatWrapping;
        groundTexture.repeat.set(groundSize / 10, groundSize / 10);
        const groundMaterial = new THREE.MeshLambertMaterial({ 
            color: 0x3a5f0b,  // Dark green color
            side: THREE.DoubleSide
        });
        const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
        groundMesh.rotation.x = -Math.PI / 2;
        groundMesh.position.y = 0;
        this.scene.add(groundMesh);

        // Add a ground body to the physics world
        const groundShape = new CANNON.Plane();
        const groundBody = new CANNON.Body({ mass: 0 });
        groundBody.addShape(groundShape);
        groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
        this.world.addBody(groundBody);

        // Remove this section that adds old trees
        // for (let i = 0; i < 50; i++) {
        //     this.addTree(
        //         Math.random() * 80 - 40,
        //         0,
        //         Math.random() * 80 - 40
        //     );
        // }

        this.loadViking(0, 0, 0);
        // Remove this line: this.updateChunks();

        // Add a test cube
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const cube = new THREE.Mesh(geometry, material);
        this.scene.add(cube);

        this.setupArmatureControl();
        this.loadTreeModel();

        // Further reduce fog
        const fogColor = new THREE.Color(0xcccccc);
        this.scene.fog = new THREE.Fog(fogColor, 100, 300); // Increased near and far values

        this.createSnow();
    }

    loadViking(x, y, z) {
        console.log("Loading Viking model...");
        this.loader.load(
            'models/viking.glb',
            (gltf) => {
                console.log("Viking model loaded successfully");
                const model = gltf.scene;
                
                // Increase the scale here. Adjust these values as needed.
                model.scale.set(10, 10, 10); // Changed from 5 to 10
                
                // Get the terrain height at the Viking's position
                const terrainHeight = this.getTerrainHeight(x, z);
                y = terrainHeight + 10; // Increased from 5 to 10 to account for larger size
                
                model.position.set(x, y, z);
                this.scene.add(model);

                // Set up the animation mixer
                this.animationMixer = new THREE.AnimationMixer(model);

                // Set up the walking animation
                const walkAnimation = gltf.animations.find(anim => anim.name === "Armature|walking_man|baselayer");
                if (walkAnimation) {
                    console.log("Walking animation found");
                    this.walkAction = this.animationMixer.clipAction(walkAnimation);
                    this.walkAction.setLoop(THREE.LoopRepeat);
                    this.walkAction.clampWhenFinished = true;
                    this.walkAction.timeScale = 1.5;
                } else {
                    console.warn("Walking animation not found in the model");
                }

                // Create a simple physics body for the Viking
                // Adjust the size of the physics body to match the new scale
                const shape = new CANNON.Box(new CANNON.Vec3(1, 2, 1)); // Increased from 0.5, 1, 0.5
                const body = new CANNON.Body({
                    mass: 5,
                    shape: shape,
                    fixedRotation: true
                });
                body.position.set(x, y, z);
                this.world.addBody(body);

                this.viking = { mesh: model, body: body };

                // Position camera relative to the Viking
                this.positionCameraRelativeToViking();

                this.isLoading = false;
                this.startAnimationLoop();

                // Load the additional animation file
                this.loadAdditionalAnimation('models/move.glb');
            },
            (xhr) => {
                console.log((xhr.loaded / xhr.total * 100) + '% loaded');
            },
            (error) => {
                console.error('An error happened while loading the Viking model', error);
            }
        );
    }

    loadAdditionalAnimation(filePath) {
        this.loader.load(
            filePath,
            (gltf) => {
                console.log("Additional animation loaded successfully");
                const newAnimation = gltf.animations[0]; // Assuming there's only one animation in the file
                if (newAnimation) {
                    this.armatureAction = this.animationMixer.clipAction(newAnimation);
                    this.armatureAction.setLoop(THREE.LoopOnce); // Set to play only once
                    this.armatureAction.clampWhenFinished = true; // Stays at the last frame when finished
                } else {
                    console.warn("No animation found in the additional file");
                }
            },
            (xhr) => {
                console.log((xhr.loaded / xhr.total * 100) + '% of additional animation loaded');
            },
            (error) => {
                console.error('An error happened while loading the additional animation', error);
            }
        );
    }

    startMove(direction) {
        console.log("Start move:", direction);
        switch(direction) {
            case 'up':
                this.moveDirection.z = -1;
                break;
            case 'down':
                this.moveDirection.z = 1;
                break;
            case 'left':
                this.moveDirection.x = -1;
                break;
            case 'right':
                this.moveDirection.x = 1;
                break;
        }
        this.isMoving = true;
        if (this.walkAction && !this.isWalking) {
            this.walkAction.play();
            this.isWalking = true;
        }
    }

    stopMove(direction) {
        console.log("Stop move:", direction);
        switch(direction) {
            case 'up':
            case 'down':
                this.moveDirection.z = 0;
                break;
            case 'left':
            case 'right':
                this.moveDirection.x = 0;
                break;
        }
        if (this.moveDirection.length() === 0) {
            this.isMoving = false;
            if (this.walkAction && this.isWalking) {
                this.walkAction.stop();
                this.isWalking = false;
            }
        }
    }

    moveViking() {
        if (this.isMoving && this.viking && this.viking.body) {
            console.log("Moving Viking");
            const movement = this.moveDirection.normalize().multiplyScalar(this.movementSpeed);
            const currentPosition = this.viking.body.position;
            const newPosition = new CANNON.Vec3(
                currentPosition.x + movement.x,
                currentPosition.y,
                currentPosition.z + movement.z
            );
            
            // Directly update the body's position
            this.viking.body.position.copy(newPosition);
            
            // Also update the mesh position
            this.viking.mesh.position.copy(newPosition);

            // Rotate the Viking to face the movement direction
            if (movement.length() > 0) {
                const angle = Math.atan2(movement.x, movement.z);
                const newQuaternion = new CANNON.Quaternion();
                newQuaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
                this.viking.body.quaternion.copy(newQuaternion);
                this.viking.mesh.quaternion.copy(newQuaternion);
            }

            this.updateCamera();
            console.log("Viking moved to:", newPosition);
        }
    }

    playAnimation(name) {
        if (this.currentAnimation) {
            this.currentAnimation.fadeOut(0.5);
        }
        this.currentAnimation = this.animations[name];
        if (this.currentAnimation) {
            this.currentAnimation.reset().fadeIn(0.5).play();
        }
    }

    startAnimationLoop() {
        console.log("Starting animation loop");
        this.animate();
    }

    animate() {
        console.log("Animating...");
        requestAnimationFrame(this.animate.bind(this));

        const delta = this.clock.getDelta();
        if (this.animationMixer) {
            this.animationMixer.update(delta);
        }

        this.world.step(1 / 60);

        this.moveViking();

        if (this.viking && this.viking.mesh) {
            this.viking.mesh.position.copy(this.viking.body.position);
            this.viking.mesh.quaternion.copy(this.viking.body.quaternion);
        }

        console.log("Rendering scene...");
        this.renderer.render(this.scene, this.camera);

        // Update tree billboarding
        if (this.trees.length > 0) {
            const cameraPosition = this.camera.position;
            this.trees.forEach(tree => {
                tree.lookAt(cameraPosition.x, tree.position.y, cameraPosition.z);
            });
        }

        // Update snow
        if (this.snow) {
            const positions = this.snow.geometry.attributes.position.array;
            for (let i = 1; i < positions.length; i += 3) {
                positions[i] -= 0.05; // Reduced fall speed for gentler snow
                if (positions[i] < 0) {
                    positions[i] = 300; // Reset to top when reaching bottom
                }
            }
            this.snow.geometry.attributes.position.needsUpdate = true;
        }
    }

    onMouseDown(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        const intersects = this.raycaster.intersectObject(this.viking.mesh);

        if (intersects.length > 0) {
            this.controls.enabled = false;
            this.isDragging = true;
        }
    }

    onMouseMove(event) {
        if (this.isDragging) {
            this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.camera);

            const intersects = this.raycaster.ray.intersectPlane(this.dragPlane, new THREE.Vector3());

            if (intersects) {
                const currentPosition = this.viking.body.position.clone();
                const newPosition = new CANNON.Vec3(intersects.x, 1.5, intersects.z);
                
                // Adjust movement speed
                const movementSpeed = 0.2; // Increased from 0.1 to 0.2
                const direction = newPosition.vsub(currentPosition).unit().scale(movementSpeed);
                const targetPosition = currentPosition.vadd(direction);
                
                if (!this.checkTreeCollision(targetPosition)) {
                    this.viking.body.position.copy(targetPosition);
                    this.viking.body.velocity.set(0, 0, 0);
                    this.animateLegs();
                    this.updateCamera();
                }
            }
        }
    }

    checkTreeCollision(position) {
        const chunkX = Math.floor(position.x / this.chunkSize);
        const chunkZ = Math.floor(position.z / this.chunkSize);

        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                const key = this.getChunkKey(chunkX + x, chunkZ + z);
                const chunk = this.chunks.get(key);
                if (chunk) {
                    for (const tree of chunk) {
                        const distance = position.distanceTo(tree.body.position);
                        if (distance < 1.5) {  // Increased collision radius
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    onMouseUp() {
        this.isDragging = false;
        this.controls.enabled = true;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    getChunkKey(x, z) {
        return `${x},${z}`;
    }

    updateChunks() {
        const vikingX = this.viking.body.position.x;
        const vikingZ = this.viking.body.position.z;
        const newChunkX = Math.floor(vikingX / this.chunkSize);
        const newChunkZ = Math.floor(vikingZ / this.chunkSize);

        if (newChunkX !== this.currentChunk.x || newChunkZ !== this.currentChunk.z) {
            this.currentChunk = { x: newChunkX, z: newChunkZ };

            for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
                for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
                    const chunkX = newChunkX + x;
                    const chunkZ = newChunkZ + z;
                    const key = this.getChunkKey(chunkX, chunkZ);

                    if (!this.chunks.has(key)) {
                        const newChunk = this.generateChunk(chunkX, chunkZ);
                        this.chunks.set(key, newChunk);
                    }
                }
            }

            // Remove out-of-range chunks
            for (const [key, chunk] of this.chunks) {
                const [chunkX, chunkZ] = key.split(',').map(Number);
                if (Math.abs(chunkX - newChunkX) > this.renderDistance || 
                    Math.abs(chunkZ - newChunkZ) > this.renderDistance) {
                    chunk.forEach(tree => {
                        this.scene.remove(tree.mesh.trunkMesh);
                        this.scene.remove(tree.mesh.leavesMesh);
                        this.world.removeBody(tree.body);
                    });
                    this.chunks.delete(key);
                }
            }
        }
    }

    updateCamera() {
        if (this.isMoving && this.viking && this.viking.body) {
            const vikingPosition = this.viking.body.position;
            const targetCameraPosition = new THREE.Vector3(
                vikingPosition.x + this.cameraOffset.x,
                vikingPosition.y + this.cameraOffset.y,
                vikingPosition.z + this.cameraOffset.z
            );
            this.camera.position.lerp(targetCameraPosition, 0.1);
            this.camera.lookAt(vikingPosition.x, vikingPosition.y + 5, vikingPosition.z);
        }
    }

    setupControls() {
        const controls = ['up', 'left', 'right', 'down'];
        controls.forEach(direction => {
            const button = document.getElementById(direction);
            button.addEventListener('mousedown', () => this.startMove(direction));
            button.addEventListener('mouseup', () => this.stopMove(direction));
            button.addEventListener('mouseleave', () => this.stopMove(direction));
        });
    }

    animateLegs() {
        // This method is no longer needed if your model has built-in walking animation
    }

    setupArmatureControl() {
        const armatureButton = document.getElementById('armature');
        armatureButton.addEventListener('click', () => this.toggleArmatureAnimation());
    }

    toggleArmatureAnimation() {
        if (!this.armatureAction) return;

        if (this.isArmatureActive) {
            return;
        }

        // Stop the walking animation
        if (this.walkAction) {
            this.walkAction.stop();
        }

        // Reset and play the armature animation
        this.armatureAction.reset();
        this.armatureAction.setLoop(THREE.LoopOnce);
        this.armatureAction.clampWhenFinished = true;
        this.armatureAction.play();
        this.isArmatureActive = true;

        // Set up a one-time event listener for when the animation finishes
        const onFinished = () => {
            this.isArmatureActive = false;
            
            // Stop the armature animation
            this.armatureAction.stop();

            // Resume the walking animation if the Viking was walking
            if (this.isWalking) {
                this.startWalking();
            }

            this.animationMixer.removeEventListener('finished', onFinished);
        };

        this.animationMixer.addEventListener('finished', onFinished);
    }

    startWalking() {
        if (this.walkAction && !this.isArmatureActive) {
            this.walkAction.reset();
            this.walkAction.play();
            this.isWalking = true;
        }
    }

    createTerrain() {
        const width = 1000;
        const height = 1000;
        const segments = 200;
        const geometry = new THREE.PlaneGeometry(width, height, segments, segments);
        const material = new THREE.MeshStandardMaterial({
            color: 0x3a5f0b,
            roughness: 0.8,
            metalness: 0.2,
            side: THREE.DoubleSide,
            vertexColors: true
        });

        const noise = new SimplexNoise();
        const vertices = geometry.attributes.position.array;
        const colors = [];

        for (let i = 0; i < vertices.length; i += 3) {
            const x = vertices[i];
            const y = vertices[i + 1];

            // Generate height using multiple octaves of Perlin noise
            let z = 0;
            let frequency = 0.005;
            let amplitude = 50;
            for (let j = 0; j < 4; j++) {
                z += noise.noise2D(x * frequency, y * frequency) * amplitude;
                frequency *= 2;
                amplitude *= 0.5;
            }

            vertices[i + 2] = z;

            // Add color based on height
            const color = new THREE.Color();
            if (z < 5) {
                color.setHex(0x2c7bb6); // Water
            } else if (z < 15) {
                color.setHex(0xabe65d); // Grass
            } else if (z < 30) {
                color.setHex(0x41ae76); // Forest
            } else {
                color.setHex(0xd8d8d8); // Snow
            }
            colors.push(color.r, color.g, color.b);
        }

        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();

        const terrain = new THREE.Mesh(geometry, material);
        terrain.rotation.x = -Math.PI / 2;
        this.scene.add(terrain);

        // Add a water plane
        const waterGeometry = new THREE.PlaneGeometry(width, height);
        const waterMaterial = new THREE.MeshStandardMaterial({
            color: 0x2c7bb6,
            transparent: true,
            opacity: 0.6
        });
        const water = new THREE.Mesh(waterGeometry, waterMaterial);
        water.rotation.x = -Math.PI / 2;
        water.position.y = 5; // Adjust this to change water level
        this.scene.add(water);
    }

    loadTreeModel() {
        console.log("Loading tree model...");
        const loader = new GLTFLoader();
        loader.load(
            'models/tree.glb',
            (gltf) => {
                console.log("Tree model loaded successfully");
                this.treeModel = gltf.scene;
                // Significantly increase the scale. Adjust these values as needed
                this.treeModel.scale.set(20, 20, 20);
                this.placeTrees();
            },
            (xhr) => {
                console.log((xhr.loaded / xhr.total * 100) + '% of tree model loaded');
            },
            (error) => {
                console.error('An error happened while loading the tree model', error);
            }
        );
    }

    placeTrees() {
        if (!this.treeModel) {
            console.warn("Tree model not loaded yet");
            return;
        }

        console.log("Placing trees");
        const numberOfTrees = 50; // Reduced number of trees due to increased size
        const terrainSize = 1000; // Should match your terrain size

        // Remove old trees if any exist
        this.trees.forEach(tree => this.scene.remove(tree));
        this.trees = [];

        for (let i = 0; i < numberOfTrees; i++) {
            const x = Math.random() * terrainSize - terrainSize / 2;
            const z = Math.random() * terrainSize - terrainSize / 2;
            const y = this.getTerrainHeight(x, z);

            if (y > 5) { // Only place trees above water level
                const tree = this.treeModel.clone();
                
                // Adjust the y position to place the tree on the ground
                // The '0.5' factor assumes the tree's origin is at its base. Adjust if needed.
                tree.position.set(x, y, z);
                
                tree.rotation.y = Math.random() * Math.PI * 2; // Random rotation
                
                // Add some random variation to tree size
                const scaleFactor = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
                tree.scale.multiplyScalar(scaleFactor);
                
                this.scene.add(tree);
                this.trees.push(tree);
                console.log(`Tree placed at (${x}, ${y}, ${z})`);
            }
        }
    }

    getTerrainHeight(x, z) {
        const noise = new SimplexNoise();
        let height = 0;
        let frequency = 0.005;
        let amplitude = 50;
        for (let i = 0; i < 4; i++) {
            height += noise.noise2D(x * frequency, z * frequency) * amplitude;
            frequency *= 2;
            amplitude *= 0.5;
        }
        return Math.max(height, 0) + 1; // Ensure the terrain height is never negative and add a small offset
    }

    positionCameraRelativeToViking() {
        if (this.viking && this.viking.body) {
            const vikingPosition = this.viking.body.position;
            this.camera.position.set(
                vikingPosition.x + this.cameraOffset.x,
                vikingPosition.y + this.cameraOffset.y + 5,
                vikingPosition.z + this.cameraOffset.z
            );
        }
    }

    createSnow() {
        const particleCount = 5000; // Increased from 1000
        const snowGeometry = new THREE.BufferGeometry();
        const snowMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.05, // Reduced size for more subtle effect
            transparent: true,
            opacity: 0.6
        });

        const positions = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount * 3; i += 3) {
            positions[i] = Math.random() * 600 - 300; // Wider spread
            positions[i + 1] = Math.random() * 300; // Higher
            positions[i + 2] = Math.random() * 600 - 300; // Wider spread
        }

        snowGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        this.snow = new THREE.Points(snowGeometry, snowMaterial);
        this.scene.add(this.snow);
    }
}

const game = new Game();
console.log("Game instance created");

