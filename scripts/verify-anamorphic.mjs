import * as THREE from "three";
import {
  configureOffAxisCamera,
  createOffAxisCamera,
  describeFaceFromEye,
} from "../src/anamorphic.js";
import {
  buildBoxFaces,
  computeEyePosition,
  createDefaultBoxDimensions,
  createDefaultViewerZone,
  FACE_IDS,
} from "../src/venueGeometry.js";

let failures = 0;

function check(label, passed, detail = "") {
  const status = passed ? "PASS" : "FAIL";
  if (!passed) failures += 1;
  console.log(`  [${status}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function approximately(actual, expected, tolerance = 1e-6) {
  return Math.abs(actual - expected) <= tolerance;
}

const dimensions = createDefaultBoxDimensions();
const faces = buildBoxFaces(dimensions);

console.log("\n1. Face normals must point out of the box");
const expectedNormals = {
  top: new THREE.Vector3(0, 1, 0),
  front: new THREE.Vector3(0, 0, 1),
  right: new THREE.Vector3(1, 0, 0),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
};
for (const faceId of FACE_IDS) {
  const farAwayEye = expectedNormals[faceId].clone().multiplyScalar(50);
  const basis = describeFaceFromEye(faces[faceId], farAwayEye);
  const normal = basis.screenNormal.clone();
  check(
    `${faceId} normal is ${expectedNormals[faceId].toArray().join(",")}`,
    normal.distanceTo(expectedNormals[faceId]) < 1e-6,
    normal.toArray().map((value) => value.toFixed(3)).join(",")
  );
}

console.log("\n2. Face corners must land exactly on the viewport edges");
const camera = createOffAxisCamera();
const viewerZone = createDefaultViewerZone(0);
const eyePosition = computeEyePosition(viewerZone, dimensions);

for (const faceId of FACE_IDS) {
  const face = faces[faceId];
  const basis = describeFaceFromEye(face, eyePosition);
  if (basis.distanceToFace <= 1e-5) {
    check(`${faceId} skipped (facing away)`, true, "expected for back/left/right");
    continue;
  }
  const configured = configureOffAxisCamera(camera, face, eyePosition);
  if (!configured) {
    check(`${faceId} configured`, false, "camera rejected the face");
    continue;
  }

  const lowerLeftNdc = face.lowerLeft.clone().project(camera);
  const lowerRightNdc = face.lowerRight.clone().project(camera);
  const upperLeftNdc = face.upperLeft.clone().project(camera);

  check(
    `${faceId} lowerLeft maps to (-1,-1)`,
    approximately(lowerLeftNdc.x, -1, 1e-5) && approximately(lowerLeftNdc.y, -1, 1e-5),
    `(${lowerLeftNdc.x.toFixed(5)}, ${lowerLeftNdc.y.toFixed(5)})`
  );
  check(
    `${faceId} lowerRight maps to (1,-1)`,
    approximately(lowerRightNdc.x, 1, 1e-5) && approximately(lowerRightNdc.y, -1, 1e-5),
    `(${lowerRightNdc.x.toFixed(5)}, ${lowerRightNdc.y.toFixed(5)})`
  );
  check(
    `${faceId} upperLeft maps to (-1,1)`,
    approximately(upperLeftNdc.x, -1, 1e-5) && approximately(upperLeftNdc.y, 1, 1e-5),
    `(${upperLeftNdc.x.toFixed(5)}, ${upperLeftNdc.y.toFixed(5)})`
  );
}

console.log("\n3. Viewer directly overhead gives a symmetric top-face frustum");
const overheadEye = new THREE.Vector3(0, 20, 0);
configureOffAxisCamera(camera, faces.top, overheadEye);
const overheadLowerLeft = faces.top.lowerLeft.clone().project(camera);
const overheadLowerRight = faces.top.lowerRight.clone().project(camera);
check(
  "top face is centred",
  approximately(overheadLowerLeft.x, -overheadLowerRight.x, 1e-5),
  `${overheadLowerLeft.x.toFixed(5)} vs ${overheadLowerRight.x.toFixed(5)}`
);

console.log("\n4. Off-centre eye must skew the frustum (this is the illusion)");
const offCentreEye = new THREE.Vector3(6, 8, 9);
configureOffAxisCamera(camera, faces.top, offCentreEye);
const headHeight = new THREE.Vector3(0, 1.2, 0);
const skewedHead = headHeight.clone().project(camera);
configureOffAxisCamera(camera, faces.top, overheadEye);
const overheadHead = headHeight.clone().project(camera);
check(
  "a raised point projects to a different pixel as the eye moves",
  Math.hypot(skewedHead.x - overheadHead.x, skewedHead.y - overheadHead.y) > 0.05,
  `moved ${Math.hypot(
    skewedHead.x - overheadHead.x,
    skewedHead.y - overheadHead.y
  ).toFixed(3)} in NDC`
);
check(
  "a point on the face plane stays put regardless of eye position",
  (() => {
    const onPlane = new THREE.Vector3(0.5, 0, 0.5);
    configureOffAxisCamera(camera, faces.top, offCentreEye);
    const fromSkew = onPlane.clone().project(camera);
    configureOffAxisCamera(camera, faces.top, overheadEye);
    const fromOverhead = onPlane.clone().project(camera);
    return Math.hypot(fromSkew.x - fromOverhead.x, fromSkew.y - fromOverhead.y) < 1e-5;
  })(),
  "confirms the face itself is pinned while volume above it shifts"
);

console.log("\n5. Faces turned away from the eye are rejected");
check(
  "back face rejected for a front viewer",
  configureOffAxisCamera(camera, faces.back, eyePosition) === false
);

console.log(
  failures === 0
    ? "\nAll anamorphic checks passed.\n"
    : `\n${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
