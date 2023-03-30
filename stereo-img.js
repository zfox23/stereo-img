// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { parseVR } from './parsers/vr-parser/vr-parser.js';
import { parseStereo } from './parsers/stereo-parser/stereo-parser.js';
import { parseAnaglyph } from './parsers/anaglyph-parser/anaglyph-parser.js';
import exifr from 'exifr';

import * as THREE from 'three';
import { VRButton } from './vr-button.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import BackwardSVG from './images/backward.svg';
import ForwardSVG from './images/forward.svg';

const svgLoader = new SVGLoader();

const clamp = (val, min, max) => {
  return Math.min(Math.max(val, min), max);
}

const linearScale = (factor, minInput, maxInput, minOutput, maxOutput, shouldClamp = true) => {
  if (shouldClamp) {
      factor = clamp(factor, minInput, maxInput);
  }

  return minOutput + (maxOutput - minOutput) *
      (factor - minInput) / (maxInput - minInput);
}

const PREV_NEXT_TIMEOUT_MS = 1000;
const PREV_NEXT_BUTTONS_Z = 9.2;
const RETICLE_INNER_OPACITY = 0.8;
const RETICLE_OUTER_OPACITY = 0.9;
const PREV_NEXT_BUTTON_TRANSPARENCY = 0.75;


class StereoImg extends HTMLElement {

  get type() {
    return this.getAttribute('type');
  }
  set type(val) {
    if (val) {
      this.setAttribute('type', val);
    } else {
      this.removeAttribute('type');
    }
  }

  get angle() {
    return this.getAttribute('angle');
  }
  set angle(val) {
    if (val) {
      this.setAttribute('angle', val);
    } else {
      this.removeAttribute('angle');
    }
  }

  get src() {
    return this.getAttribute('src');
  }
  set src(val) {
    if (this.getAttribute('src') === val) {
      this.camera?.position.set(0, 0, 0.1);
      return;
    }

    if (val) {
      this.setAttribute('src', val);
    } else {
      this.removeAttribute('src');
    }

    // use setTimeout to ensure all DOM updates have finished, it's indeed common to update both src= and type= at the same time.
    // There is probably a cleaner way to do this.
    let that = this;
    window.setTimeout(() => {
      that.parseImageAndInitialize3DScene();
    }, 0);
  }

  get backImageSrc() {
    return this.getAttribute('backImageSrc');
  }
  set backImageSrc(val) {
    if (val) {
      this.setAttribute('backImageSrc', val);
    } else {
      this.removeAttribute('backImageSrc');
    }

    // use setTimeout to ensure all DOM updates have finished, it's indeed common to update both src= and type= at the same time.
    // There is probably a cleaner way to do this.
    let that = this;
    window.setTimeout(() => {
      that.parseImageAndInitialize3DScene();
    }, 0);
  }

  prevNextTest() {
    if (!(this.scene && this.camera && this.raycaster && this.prevNextButtons)) {
      return;
    }

    // update the picking ray with the camera and pointer position
    this.raycaster.set(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()));

    // calculate objects intersecting the picking ray
    const intersects = this.raycaster.intersectObjects(this.prevNextButtons);

    if ((!intersects || intersects.length === 0) && this.prevNextTimer) {
      clearTimeout(this.prevNextTimer);
      this.prevNextTimer = null;
      return;
    }


    for (let i = 0; i < intersects.length; i++) {
      if (!(intersects[i].object && intersects[i].object.parent)) {
        return;
      }

      if (intersects[i].object.parent.name === "prev") {
        this.timerRingForPrev = true;
        if (!this.prevNextTimer) {
          this.prevNextTimerStartMS = performance.now();
          this.prevNextTimer = setTimeout(() => {
            clearTimeout(this.prevNextTimer);
            this.prevNextTimer = null;
            this.dispatchEvent(new Event("stereoImgGoToPrev"));
          }, PREV_NEXT_TIMEOUT_MS)
        }
      } else if (intersects[i].object.parent.name === "next") {
        this.timerRingForPrev = false;
        if (!this.prevNextTimer) {
          this.prevNextTimerStartMS = performance.now();
          this.prevNextTimer = setTimeout(() => {
            clearTimeout(this.prevNextTimer);
            this.prevNextTimer = null;
            this.dispatchEvent(new Event("stereoImgGoToNext"));
          }, PREV_NEXT_TIMEOUT_MS)
        }
      }
    }
  }

  updatePrevNextRing() {
    if (this.timerRing) {
      this.scene.remove(this.timerRing);
      this.timerRing = null;
    }

    if (this.prevNextButtons && this.prevNextButtons.length) {
      this.prevNextButtons.forEach(button => {
        button.lookAt(this.camera.position);
      })
    }
    
    if (this.prevNextTimer) {
      const timeSinceStartedMS = performance.now() - this.prevNextTimerStartMS;

      const timerRingMaterial = new THREE.MeshBasicMaterial({ color: 0xf4870e, side: THREE.DoubleSide, depthWrite: false });
      const timerRingGeometry = new THREE.RingGeometry(1.0, 1.10, 128, 1, 0, linearScale(timeSinceStartedMS, 0, PREV_NEXT_TIMEOUT_MS, 0, this.timerRingForPrev ? Math.PI * 2 : -Math.PI * 2));
      this.timerRing = new THREE.Mesh(
        timerRingGeometry,
        timerRingMaterial
      );
      this.timerRing.position.x = this.timerRingForPrev ? -PREV_NEXT_BUTTONS_Z : PREV_NEXT_BUTTONS_Z;
      this.timerRing.position.z = 1.0;
      this.timerRing.up.set(1, 0, 0);
      this.timerRing.lookAt(this.camera.position);
      // this.timerRing.rotation.x = Math.PI / 2;
      // this.timerRing.rotation.y = Math.PI / 2;
      this.scene.add(this.timerRing);

      // this.innerReticleMaterial.opacity = RETICLE_INNER_OPACITY;
      // this.outerReticleMaterial.opacity = RETICLE_OUTER_OPACITY;
    } else {
      // this.innerReticleMaterial.opacity = 0.0;
      // this.outerReticleMaterial.opacity = 0.0;
    }
  }

  animate() {
    this.renderer.setAnimationLoop(() => {
      this.controls?.update();
      this.prevNextTest();
      this.updatePrevNextRing();
      this.renderer.render(this.scene, this.camera);
    });
  }

  async parse() {
    if (this.src) {
      if (this.type === 'vr') {
        this.stereoData = await parseVR(this.src);
      } else if (this.type === 'left-right' || this.type === 'top-bottom') {
        this.stereoData = await parseStereo(this.src, {
          type: this.type,
          angle: this.angle,
        });
      } else if (this.type === 'anaglyph') {
        this.stereoData = await parseAnaglyph(this.src, {
          angle: this.angle,
        });
      } else {
        // Read XMP metadata
        const exif = await exifr.parse(this.src, {
          xmp: true,
          multiSegment: true,
          mergeOutput: false,
          ihdr: true, //unclear why we need this, but if not enabled, some VR180 XMP Data are not parsed
        });

        if (exif?.GImage?.Data) {
          // XMP for left eye found, assume VR Photo
          this.stereoData = await parseVR(this.src);
        } else {
          // no left eye found, assume left-right
          console.warn('<stereo-img> does not have a "type" attribute and image does not have XMP metadata of a VR picture.  Use "type" attribute to specify the type of stereoscopic image. Assuming left-right stereo image.');
          this.stereoData = await parseStereo(this.src, {
            angle: this.angle,
          });
        }
      }
    } else {
      // no src attribute. Use fake stereo data.
      this.stereoData = {
        leftEye: new ImageData(10, 10),
        rightEye: new ImageData(10, 10),
        phiLength: 0,
        thetaStart: 0,
        thetaLength: 0
      };
    }
  }

  async initialize3DScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101010);

    const radius = 10; // 500

    // left eye
    const texture1 = new THREE.Texture(this.stereoData.leftEye);
    texture1.needsUpdate = true;

    // TODO: Screen size should depend on image aspect ratio, camera fov...
    const geometry1 = new THREE.SphereGeometry(radius, 60, 40, -1 * this.stereoData.phiLength / 2, this.stereoData.phiLength, this.stereoData.thetaStart, this.stereoData.thetaLength);
    // invert the geometry on the x-axis so that all of the faces point inward
    geometry1.scale(- 1, 1, 1);

    const material1 = new THREE.MeshBasicMaterial({ map: texture1 });

    const mesh1 = new THREE.Mesh(geometry1, material1);
    mesh1.rotation.reorder('YXZ');
    mesh1.rotation.y = Math.PI / 2;
    mesh1.rotation.x = this.stereoData.roll || 0;
    mesh1.rotation.z = this.stereoData.pitch || 0;
    mesh1.layers.set(1); // display in left eye only
    this.scene.add(mesh1);


    // right eye

    const texture2 = new THREE.Texture(this.stereoData.rightEye);
    texture2.needsUpdate = true;

    const geometry2 = new THREE.SphereGeometry(radius, 60, 40, -1 * this.stereoData.phiLength / 2, this.stereoData.phiLength, this.stereoData.thetaStart, this.stereoData.thetaLength);
    geometry2.scale(- 1, 1, 1);

    const material2 = new THREE.MeshBasicMaterial({ map: texture2 });

    const mesh2 = new THREE.Mesh(geometry2, material2);
    mesh2.rotation.reorder('YXZ');
    mesh2.rotation.y = Math.PI / 2;
    mesh2.rotation.x = this.stereoData.roll || 0;
    mesh2.rotation.z = this.stereoData.pitch || 0;
    mesh2.layers.set(2); // display in right eye only
    this.scene.add(mesh2);


    // "curious human" image
    if (this.angle === "180" && this.backImageSrc) {
      const backImage = new Image();
      const texture3 = new THREE.Texture(backImage);
      backImage.addEventListener('load', () => {
        texture3.needsUpdate = true
      });
      backImage.src = this.backImageSrc;

      // Removes seam between images
      const EPSILON_PHI_LENGTH = 0.025;
      const geometry3 = new THREE.SphereGeometry(radius, 60, 40, -1 * this.stereoData.phiLength / 2 - EPSILON_PHI_LENGTH, this.stereoData.phiLength + 2 * EPSILON_PHI_LENGTH, this.stereoData.thetaStart, this.stereoData.thetaLength);
      geometry3.scale(- 1, 1, 1);

      const material3 = new THREE.MeshBasicMaterial({ map: texture3 });

      const mesh3 = new THREE.Mesh(geometry3, material3);
      mesh3.rotation.reorder('YXZ');
      mesh3.rotation.y = -Math.PI / 2;
      mesh3.rotation.x = this.stereoData.roll || 0;
      mesh3.rotation.z = this.stereoData.pitch || 0;
      mesh3.layers.set(0);
      this.scene.add(mesh3);
    }
  }

  async parseImageAndInitialize3DScene() {
    this.style.opacity = '0';
    await this.parse();
    await this.initialize3DScene();
    this.camera?.position.set(0, 0, 0.1);

    if (this.camera) {
      // this.addReticle();
      this.addPrevNextButtons();
    }

    this.style.opacity = '1';
  }

  addReticle() {
    const RETICLE_RADIUS_INNER = 0.05;
    const RETICLE_RADIUS_OUTER = RETICLE_RADIUS_INNER * 1.3;
    const RETICLE_NUM_SEGMENTS = 128;
    this.outerReticleMaterial = new THREE.MeshBasicMaterial({ color: 0x0d0500, side: THREE.DoubleSide, depthWrite: false });
    this.outerReticleMaterial.transparent = true;
    this.outerReticleMaterial.opacity = 0.0;
    this.outerReticle = new THREE.Mesh(
      new THREE.RingGeometry(RETICLE_RADIUS_INNER, RETICLE_RADIUS_OUTER, RETICLE_NUM_SEGMENTS),
      this.outerReticleMaterial
    );
    this.outerReticle.position.z = -PREV_NEXT_BUTTONS_Z;
    this.outerReticle.lookAt(this.camera.position);
    this.camera.add(this.outerReticle);

    this.innerReticleMaterial = new THREE.MeshBasicMaterial({ color: 0xf4870e, side: THREE.DoubleSide, depthWrite: false });
    this.innerReticleMaterial.transparent = true;
    this.innerReticleMaterial.opacity = 0.0;
    this.innerReticle = new THREE.Mesh(
      new THREE.CircleGeometry(RETICLE_RADIUS_INNER, RETICLE_NUM_SEGMENTS),
      this.innerReticleMaterial
    );
    this.innerReticle.position.z = -PREV_NEXT_BUTTONS_Z;
    this.innerReticle.lookAt(this.camera.position);
    this.camera.add(this.innerReticle);

    this.scene.add(this.camera);
  }

  createPrevOrNextButton(isPrevButton) {
    const buttonGroup = new THREE.Group();
    buttonGroup.name = isPrevButton ? 'prev' : 'next';

    this.buttonOuterMaterial = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, side: THREE.DoubleSide, depthWrite: false });
    this.buttonOuterGeometry = new THREE.RingGeometry(1.0, 1.1, 128);
    if (isPrevButton) {
      this.prevButtonOuter = new THREE.Mesh(
        this.buttonOuterGeometry,
        this.buttonOuterMaterial
      );
      buttonGroup.add(this.prevButtonOuter);
    } else {
      this.nextButtonOuter = new THREE.Mesh(
        this.buttonOuterGeometry,
        this.buttonOuterMaterial
      );
      buttonGroup.add(this.nextButtonOuter);
    }

    this.buttonInnerMaterial = new THREE.MeshBasicMaterial({ color: 0xa65700, side: THREE.DoubleSide, depthWrite: false });
    const buttonInner = new THREE.Mesh(
      new THREE.CircleGeometry(1, 128),
      this.buttonInnerMaterial
    );
    buttonGroup.add(buttonInner);

    svgLoader.load(
      // resource URL
      isPrevButton ? BackwardSVG : ForwardSVG,
      // called when the resource is loaded
      (data) => {
        const paths = data.paths;
        const group = new THREE.Group();

        for (let i = 0; i < paths.length; i++) {
          const path = paths[i];
          const material = new THREE.MeshBasicMaterial({
            color: 0xaaaaaa,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          const shapes = SVGLoader.createShapes(path);
          for (let j = 0; j < shapes.length; j++) {
            const shape = shapes[j];
            const geometry = new THREE.ShapeGeometry(shape);
            geometry.scale(0.06, 0.06, 0.06);
            geometry.translate(isPrevButton ? -0.66 : -0.58, -0.37, 0);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.name = buttonGroup.name;
            group.add(mesh);
          }
        }
        buttonGroup.add(group);
      },
      (xhr) => { },
      (error) => { console.log('Error while loading SVG:', error); }
    );

    buttonGroup.position.x = isPrevButton ? -PREV_NEXT_BUTTONS_Z : PREV_NEXT_BUTTONS_Z;
    buttonGroup.position.z = 1.0;
    buttonGroup.lookAt(this.camera.position);
    // buttonGroup.layers.disable(0);
    // buttonGroup.layers.enable(1);
    // buttonGroup.layers.enable(2);

    return buttonGroup;
  }

  addPrevNextButtons() {
    this.prevNextButtons = [this.createPrevOrNextButton(true), this.createPrevOrNextButton(false)];
    this.scene.add(this.prevNextButtons[0]);
    this.scene.add(this.prevNextButtons[1]);
  }

  async init() {
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          contain: content;
        }
      </style>
      `;

    // TODO: should we also read width and height attributes and resize element accordingly?
    if (this.clientHeight === 0) {
      const aspectRatio = 4 / 3;
      this.style.height = this.clientWidth / aspectRatio + "px";
    }

    await this.parseImageAndInitialize3DScene();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.xr.enabled = true;
    this.renderer.setSize(this.clientWidth, this.clientHeight);
    this.shadowRoot.appendChild(this.renderer.domElement);

    // TODO: Should we use component size instead?
    this.camera = new THREE.PerspectiveCamera(70, this.clientWidth / this.clientHeight, 1, 2000);
    this.camera.layers.enable(1);

    this.raycaster = new THREE.Raycaster();
    // this.addReticle();
    this.addPrevNextButtons();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.125;
    this.controls.rotateSpeed = -0.25;
    this.controls.enableZoom = false;
    this.controls.addEventListener("change", () => {
      if (this.renderer) {
        this.renderer.render(this.scene, this.camera);
      }
    });
    this.camera.position.set(0, 0, 0.1);

    this.shadowRoot.appendChild(VRButton.createButton(this.renderer));

    this.animate();

    // Listen for component resize
    const resizeObserver = new ResizeObserver(() => {
      this.renderer.setSize(this.clientWidth, this.clientHeight);
      this.camera.aspect = this.clientWidth / this.clientHeight;
      this.camera.updateProjectionMatrix();
    });

    resizeObserver.observe(this);
  }


  constructor() {
    super();
    this.init();
  }

}

if (window.customElements.get('stereo-img') === undefined) {
  window.customElements.define('stereo-img', StereoImg);
}

