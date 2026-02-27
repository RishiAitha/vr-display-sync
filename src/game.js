import * as THREE from 'three';
import { XR_BUTTONS } from 'gamepad-wrapper';

export default {
    // Instance variables here

    // VR handling
    // Use context.sendGameMessage(payload) to emit game events.

    // VR-side initialization hook.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage }
    async startVR(context) {
        this.latestPoint = {};
        this.prevControllerPositions = { right: null, left: null };
        
        const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), sphereMaterial);
        context.scene.add(this.marker);

        // Create cross-hair lines perpendicular to the direction vector
        const horizontalMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
        const verticalMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
        
        const points = [ new THREE.Vector3(), new THREE.Vector3() ];
        
        this.horizontalLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            horizontalMaterial
        );
        this.horizontalLine.frustumCulled = false;
        context.scene.add(this.horizontalLine);
        
        this.verticalLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            verticalMaterial
        );
        this.verticalLine.frustumCulled = false;
        context.scene.add(this.verticalLine);

        // Line to show controller crossing direction
        const crossingMaterial = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 3 });
        this.crossingLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            crossingMaterial
        );
        this.crossingLine.frustumCulled = false;
        this.crossingLine.visible = false;
        context.scene.add(this.crossingLine);
        
        // Cone to show direction of crossing
        const coneGeometry = new THREE.ConeGeometry(0.02, 0.06, 8);
        const coneMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
        this.crossingCone = new THREE.Mesh(coneGeometry, coneMaterial);
        this.crossingCone.frustumCulled = false;
        this.crossingCone.visible = false;
        context.scene.add(this.crossingCone);
        
        this.crossingFadeTime = 0;
    },

    // Per-frame VR update. delta,time in seconds. context same as startVR.
    // context: { scene, camera, renderer, player, controllers, sendGameMessage,
    //            screenState, screenMeta, screenRect }
    // - `screenState`: object with `right` and `left` entries, each `{ onScreen, canvasX, canvasY, uv, hitPoint }` (per-frame intersection)
    //      - if onScreen is false, nothing else is sent; canvasX and canvasY are canvas coords, hitPoint is WebXR coords, uv is 2D coords on rect.
    // - `screenMeta`: metadata snapshot `{ screenWidth, screenHeight, topLeftCorner, bottomRightCorner, rectXDistance, rectYDistance }`
    // - `screenRect`: the THREE.Mesh used to represent the screen rect (optional)
    updateVR(delta, time, context) {
        if (this.latestPoint && context.screenRect) {
            const point = this.latestPoint;
            const targetUVx = point.canvasX / point.screenWidth;
            const targetUVy = 1 - (point.canvasY / point.screenHeight); // Note: flipped for Three.js UV space
            
            // Find the position on the curved screen mesh by sampling the geometry
            let worldPoint = null;
            context.screenRect.traverse((node) => {
                if (node.isMesh && node.geometry && !worldPoint) {
                    const geometry = node.geometry;
                    const positionAttr = geometry.getAttribute('position');
                    const uvAttr = geometry.getAttribute('uv');
                    
                    if (positionAttr && uvAttr) {
                        // Find closest triangle by UV coordinates
                        let closestDist = Infinity;
                        let closestPos = new THREE.Vector3();
                        
                        const index = geometry.index;
                        const faceCount = index ? index.count / 3 : positionAttr.count / 3;
                        
                        for (let i = 0; i < faceCount; i++) {
                            const i0 = index ? index.getX(i * 3) : i * 3;
                            const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
                            const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;
                            
                            const uv0 = new THREE.Vector2(uvAttr.getX(i0), uvAttr.getY(i0));
                            const uv1 = new THREE.Vector2(uvAttr.getX(i1), uvAttr.getY(i1));
                            const uv2 = new THREE.Vector2(uvAttr.getX(i2), uvAttr.getY(i2));
                            
                            // Check if target UV is inside this triangle
                            const targetUV = new THREE.Vector2(targetUVx, targetUVy);
                            const barycentric = new THREE.Vector3();
                            
                            // Simple barycentric coordinate calculation
                            const v0 = uv1.clone().sub(uv0);
                            const v1 = uv2.clone().sub(uv0);
                            const v2 = targetUV.clone().sub(uv0);
                            
                            const d00 = v0.dot(v0);
                            const d01 = v0.dot(v1);
                            const d11 = v1.dot(v1);
                            const d20 = v2.dot(v0);
                            const d21 = v2.dot(v1);
                            
                            const denom = d00 * d11 - d01 * d01;
                            if (Math.abs(denom) < 0.0001) continue;
                            
                            const v = (d11 * d20 - d01 * d21) / denom;
                            const w = (d00 * d21 - d01 * d20) / denom;
                            const u = 1 - v - w;
                            
                            // Check if point is inside triangle (with some tolerance)
                            if (u >= -0.01 && v >= -0.01 && w >= -0.01) {
                                const p0 = new THREE.Vector3(positionAttr.getX(i0), positionAttr.getY(i0), positionAttr.getZ(i0));
                                const p1 = new THREE.Vector3(positionAttr.getX(i1), positionAttr.getY(i1), positionAttr.getZ(i1));
                                const p2 = new THREE.Vector3(positionAttr.getX(i2), positionAttr.getY(i2), positionAttr.getZ(i2));
                                
                                // Interpolate position using barycentric coordinates
                                const localPos = new THREE.Vector3()
                                    .addScaledVector(p0, u)
                                    .addScaledVector(p1, v)
                                    .addScaledVector(p2, w);
                                
                                // Convert to world space
                                worldPoint = localPos.clone();
                                node.localToWorld(worldPoint);
                                break;
                            }
                        }
                    }
                }
            });
            
            // Fallback to flat plane calculation if geometry sampling fails
            if (!worldPoint) {
                const local = new THREE.Vector3((targetUVx - 0.5) * context.screenMeta.rectXDistance, (0.5 - targetUVy) * context.screenMeta.rectYDistance, 0);
                worldPoint = local.clone();
                context.screenRect.localToWorld(worldPoint);
            }


            if (worldPoint) {
                if (this.marker) {
                    this.marker.position.copy(worldPoint);
                    this.marker.visible = true;
                }

                const headsetPos = new THREE.Vector3();
                context.camera.getWorldPosition(headsetPos);

                const dir = worldPoint.clone().sub(headsetPos).normalize();

                // Create perpendicular vectors to form a cross-hair
                // Choose a reference vector that isn't parallel to dir
                const worldUp = new THREE.Vector3(0, 1, 0);
                const worldForward = new THREE.Vector3(0, 0, 1);
                
                // If dir is too close to parallel with worldUp, use worldForward instead
                const upDot = Math.abs(dir.dot(worldUp));
                const referenceVec = upDot > 0.9 ? worldForward : worldUp;
                
                const right = new THREE.Vector3().crossVectors(referenceVec, dir).normalize();
                const up = new THREE.Vector3().crossVectors(dir, right).normalize();

                // Length of cross-hair lines
                const lineLength = 0.15;

                // Horizontal line (perpendicular to direction)
                if (this.horizontalLine && this.horizontalLine.geometry) {
                    const hStart = worldPoint.clone().add(right.clone().multiplyScalar(-lineLength));
                    const hEnd = worldPoint.clone().add(right.clone().multiplyScalar(lineLength));
                    this.horizontalLine.geometry.setFromPoints([hStart, hEnd]);
                    this.horizontalLine.visible = true;
                }

                // Vertical line (perpendicular to direction)
                if (this.verticalLine && this.verticalLine.geometry) {
                    const vStart = worldPoint.clone().add(up.clone().multiplyScalar(-lineLength));
                    const vEnd = worldPoint.clone().add(up.clone().multiplyScalar(lineLength));
                    this.verticalLine.geometry.setFromPoints([vStart, vEnd]);
                    this.verticalLine.visible = true;
                }

                // Check for controller crossing the point-to-headset vector
                ['right', 'left'].forEach((side) => {
                    const controller = context.controllers && context.controllers[side];
                    if (controller && controller.raySpace) {
                        const currentPos = new THREE.Vector3();
                        controller.raySpace.getWorldPosition(currentPos);
                        
                        if (this.prevControllerPositions[side]) {
                            const prevPos = this.prevControllerPositions[side];
                            
                            // Find closest points between the two line segments
                            // Line 1: headsetPos to worldPoint
                            // Line 2: prevPos to currentPos
                            const closestPoint = this.closestPointBetweenLines(
                                headsetPos, worldPoint,
                                prevPos, currentPos
                            );
                            
                            // If the closest distance is small enough, we've crossed
                            if (closestPoint && closestPoint.distance < 0.05) {
                                // Calculate the perpendicular movement direction
                                const movement = currentPos.clone().sub(prevPos);
                                
                                // Project movement onto the plane perpendicular to dir
                                const parallelComponent = dir.clone().multiplyScalar(movement.dot(dir));
                                const perpMovement = movement.clone().sub(parallelComponent);
                                
                                if (perpMovement.length() > 0.001) {
                                    perpMovement.normalize();
                                    
                                    // Draw the crossing line at the intersection point
                                    const crossLength = 0.3;
                                    const crossStart = closestPoint.point.clone().add(perpMovement.clone().multiplyScalar(-crossLength / 2));
                                    const crossEnd = closestPoint.point.clone().add(perpMovement.clone().multiplyScalar(crossLength / 2));
                                    
                                    if (this.crossingLine && this.crossingLine.geometry) {
                                        this.crossingLine.geometry.setFromPoints([crossStart, crossEnd]);
                                        this.crossingLine.visible = true;
                                        this.crossingFadeTime = 2.0; // Show for 2 seconds
                                    }
                                    
                                    // Position and orient the cone to point in the direction of movement
                                    if (this.crossingCone) {
                                        this.crossingCone.position.copy(crossEnd);
                                        
                                        // Rotate cone to point in perpMovement direction
                                        // Default cone points up (0, 1, 0), rotate it to point along perpMovement
                                        const defaultDir = new THREE.Vector3(0, 1, 0);
                                        const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultDir, perpMovement);
                                        this.crossingCone.quaternion.copy(quaternion);
                                        
                                        this.crossingCone.visible = true;
                                    }
                                }
                            }
                        }
                        
                        this.prevControllerPositions[side] = currentPos.clone();
                    }
                });
                
                // Fade out crossing line and cone over time
                if (this.crossingFadeTime > 0) {
                    this.crossingFadeTime -= delta;
                    if (this.crossingFadeTime <= 0) {
                        this.crossingLine.visible = false;
                        this.crossingCone.visible = false;
                    }
                }
            }
        }
    },

    // Helper function to find closest points between two line segments
    closestPointBetweenLines(a1, a2, b1, b2) {
        const da = a2.clone().sub(a1);
        const db = b2.clone().sub(b1);
        const dc = b1.clone().sub(a1);
        
        const crossDaDb = new THREE.Vector3().crossVectors(da, db);
        const denom = crossDaDb.lengthSq();
        
        // Lines are parallel
        if (denom < 0.0001) return null;
        
        // Calculate closest parameters
        const t = new THREE.Vector3().crossVectors(dc, db).dot(crossDaDb) / denom;
        const u = new THREE.Vector3().crossVectors(dc, da).dot(crossDaDb) / denom;
        
        // Clamp to line segments
        const tClamped = Math.max(0, Math.min(1, t));
        const uClamped = Math.max(0, Math.min(1, u));
        
        const pointOnA = a1.clone().add(da.clone().multiplyScalar(tClamped));
        const pointOnB = b1.clone().add(db.clone().multiplyScalar(uClamped));
        
        const distance = pointOnA.distanceTo(pointOnB);
        const midPoint = new THREE.Vector3().addVectors(pointOnA, pointOnB).multiplyScalar(0.5);
        
        return { distance, point: midPoint, t: tClamped, u: uClamped };
    },

    // Screen handling
    // Use context.canvas to draw, context.sendGameMessage to emit events.

    // Screen-side initialization.
    // context: { canvas, sendGameMessage }
    async startScreen(context) {
        const canvas = context.canvas;
        const ctx = canvas.getContext('2d');

        function pickAndSendPoint() {
            const x = Math.floor(Math.random() * canvas.width);
            const y = Math.floor(Math.random() * canvas.height);

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'red';
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, Math.PI * 2);
            ctx.fill();

            context.sendGameMessage({
                event: 'RANDOM_POINT',
                canvasX: x,
                canvasY: y,
                screenWidth: canvas.width,
                screenHeight: canvas.height
            });
        }

        setInterval(pickAndSendPoint, 3000);
    },

    // Optional per-frame Screen update. delta,time in seconds.
    // context: { canvas, sendGameMessage }
    updateScreen(delta, time, context) {
        // Optional per-frame screen logic
    },

    /*
        Incoming messages handler.

        All controller data is available directly in updateVR via context.controllers, 
        context.screenState, and context.screenMeta. Use sendGameMessage to communicate 
        between VR and screen clients when custom events are needed.

        Handle messages sent via `sendGameMessage` here as you like.
    */
    onMessage(msg) {
        if (!msg) return;

        if (msg.event === 'RANDOM_POINT') {
            this.latestPoint = msg;
        }

        console.log('game onMessage received', msg);
    }
};