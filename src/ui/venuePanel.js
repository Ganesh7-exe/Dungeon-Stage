import {
  createButtonRow,
  createCard,
  createNumberRow,
  createSelectRow,
  createSliderRow,
  createToggleRow,
} from "./controlBuilders.js";
import {
  createDefaultProjector,
  FACE_IDS,
  FACE_LABELS,
  getProjectorById,
  normalizeVenueState,
  placeViewerAboveBox,
  syncViewerPolarFromPosition,
  syncViewerPositionFromPolar,
} from "../venueGeometry.js";
import { listProjectorOutputDisplays } from "../displayOutput.js";

/**
 * Real-life box projection setup:
 * 1) Match physical box size
 * 2) Align corners in Mapping Studio / projector feed
 * 3) Optional advanced sweet-spot / lamp helper
 */

export function createVenuePanel({
  container,
  getVenue,
  onChange,
  onOpenProjectorWindow,
  onOpenMappingStudio,
  onFrameActiveEye,
  onResetPreviewCamera,
}) {
  const { card } = createCard({
    title: "Align to box",
    badge: "Project",
    kicker: "Match box size, then drag four corners on the projector feed.",
  });

  const commit = (mutate) => {
    const next = normalizeVenueState(structuredClone(getVenue()));
    mutate(next);
    onChange(normalizeVenueState(next));
  };

  const commitProjector = (mutate) => {
    commit((venue) => {
      const projector = getProjectorById(venue, venue.activeProjectorId);
      if (projector) mutate(projector, venue);
    });
  };

  const enabledToggle = createToggleRow({
    label: "Enable projection",
    checked: getVenue().enabled,
    onChange: (checked) =>
      commit((venue) => {
        venue.enabled = checked;
      }),
  });
  card.appendChild(enabledToggle.row);

  const boxGrid = document.createElement("div");
  boxGrid.className = "voice-tweak-grid";
  card.appendChild(boxGrid);

  const boxWidth = createNumberRow({
    label: "W",
    suffix: "cm",
    min: 10,
    max: 2000,
    value: getVenue().box.widthCm,
    onChange: (value) => commit((venue) => { venue.box.widthCm = value; }),
  });
  const boxDepth = createNumberRow({
    label: "D",
    suffix: "cm",
    min: 10,
    max: 2000,
    value: getVenue().box.depthCm,
    onChange: (value) => commit((venue) => { venue.box.depthCm = value; }),
  });
  const boxHeight = createNumberRow({
    label: "H",
    suffix: "cm",
    min: 0,
    max: 2000,
    value: getVenue().box.heightCm,
    onChange: (value) => commit((venue) => { venue.box.heightCm = value; }),
  });
  boxGrid.append(boxWidth.row, boxDepth.row, boxHeight.row);

  card.appendChild(
    createButtonRow([
      {
        id: "align-to-real-box",
        label: "Align to real box",
        className: "btn btn-primary",
        onClick: () => onOpenMappingStudio?.(getVenue().activeProjectorId),
      },
    ])
  );

  const outputDisplaySelect = createSelectRow({
    label: "Projector display",
    options: [{ value: "", label: "Detecting displays…" }],
    value: getVenue().outputDisplayId || "",
    onChange: (value) =>
      commit((venue) => {
        venue.outputDisplayId = value;
      }),
  });
  card.appendChild(outputDisplaySelect.row);

  const fullscreenToggle = createToggleRow({
    label: "Fullscreen on that display",
    checked: getVenue().openFullscreenOnOutput !== false,
    onChange: (checked) =>
      commit((venue) => {
        venue.openFullscreenOnOutput = checked;
      }),
  });
  card.appendChild(fullscreenToggle.row);

  card.appendChild(
    createButtonRow([
      {
        label: "Open projector feed",
        onClick: () => onOpenProjectorWindow?.(getVenue().activeProjectorId),
      },
      {
        label: "Refresh displays",
        onClick: () => {
          refreshDisplayList();
        },
      },
    ])
  );

  let displayRefreshToken = 0;
  async function refreshDisplayList() {
    const token = ++displayRefreshToken;
    let displays = [];
    try {
      displays = await listProjectorOutputDisplays();
    } catch {
      displays = [];
    }
    if (token !== displayRefreshToken) return;

    const options = displays.map((display) => ({
      value: display.id,
      label: display.label,
    }));
    if (!options.length) {
      options.push({ value: "", label: "No displays found" });
    }

    const venue = normalizeVenueState(getVenue());
    let selected = venue.outputDisplayId;
    const hasSelected = options.some((option) => option.value === selected);
    if (!hasSelected) {
      const primary = displays.find((display) => display.primary);
      selected = primary?.id || options[0].value;
    }

    outputDisplaySelect.setOptions(options, selected);
    if (selected !== venue.outputDisplayId) {
      commit((nextVenue) => {
        nextVenue.outputDisplayId = selected;
      });
    }
  }

  refreshDisplayList();

  const outlineToggle = createToggleRow({
    label: "Corner outlines on feed",
    checked: getVenue().showFaceOutlines,
    onChange: (checked) =>
      commit((venue) => { venue.showFaceOutlines = checked; }),
  });
  card.appendChild(outlineToggle.row);

  const advanced = document.createElement("details");
  advanced.className = "card-fold";
  const advancedSummary = document.createElement("summary");
  advancedSummary.textContent = "Advanced · lamp / faces";
  advanced.appendChild(advancedSummary);
  card.appendChild(advanced);

  const frustumToggle = createToggleRow({
    label: "Show lamp aim helper",
    checked: getVenue().showFrustumHelpers,
    onChange: (checked) =>
      commit((venue) => { venue.showFrustumHelpers = checked; }),
  });
  advanced.appendChild(frustumToggle.row);

  const projectorSelect = createSelectRow({
    label: "Active projector",
    options: getVenue().projectors.map((projector) => ({
      value: projector.id,
      label: projector.label,
    })),
    value: getVenue().activeProjectorId,
    onChange: (value) =>
      commit((venue) => { venue.activeProjectorId = value; }),
  });
  advanced.appendChild(projectorSelect.row);

  const projectionModeSelect = createSelectRow({
    label: "Picture style",
    options: [
      {
        value: "projector",
        label: "Map + keystone",
      },
      {
        value: "anamorphic",
        label: "Anamorphic",
      },
    ],
    value: getVenue().projectors[0]?.projectionMode || "projector",
    onChange: (value) =>
      commitProjector((projector) => {
        projector.projectionMode =
          value === "anamorphic" ? "anamorphic" : "projector";
      }),
  });
  advanced.appendChild(projectionModeSelect.row);

  advanced.appendChild(
    createButtonRow([
      {
        label: "Add projector",
        onClick: () =>
          commit((venue) => {
            if (venue.projectors.length >= 6) return;
            const index = venue.projectors.length;
            const spacing = 360 / (index + 1);
            const projector = createDefaultProjector(index, index * spacing);
            venue.projectors.push(projector);
            venue.activeProjectorId = projector.id;
            venue.enabled = true;
          }),
      },
      {
        label: "Remove",
        onClick: () =>
          commit((venue) => {
            if (venue.projectors.length <= 1) return;
            venue.projectors = venue.projectors.filter(
              (projector) => projector.id !== venue.activeProjectorId
            );
            venue.activeProjectorId = venue.projectors[0].id;
          }),
      },
    ])
  );

  advanced.appendChild(
    createButtonRow([
      {
        label: "Place lamp above box",
        onClick: () =>
          commitProjector((projector) => {
            placeViewerAboveBox(projector.viewer, 3.5);
            projector.azimuthDegrees = projector.viewer.azimuthDegrees;
            if (!projector.faceIds.includes("top")) {
              projector.faceIds = ["top", ...projector.faceIds];
            }
          }),
      },
    ])
  );

  const positionGrid = document.createElement("div");
  positionGrid.className = "voice-tweak-grid";
  advanced.appendChild(positionGrid);

  const writePosition = (axis, value) => {
    commitProjector((projector) => {
      const position = projector.viewer.positionM || { x: 0, y: 3.5, z: 6 };
      position[axis] = value;
      projector.viewer.positionM = position;
      syncViewerPolarFromPosition(projector.viewer);
      projector.azimuthDegrees = projector.viewer.azimuthDegrees;
    });
  };

  const posX = createNumberRow({
    label: "X",
    suffix: " m",
    min: -40,
    max: 40,
    step: 0.1,
    value: getVenue().projectors[0].viewer.positionM?.x ?? 0,
    onChange: (value) => writePosition("x", value),
  });
  const posY = createNumberRow({
    label: "Y",
    suffix: " m",
    min: -5,
    max: 25,
    step: 0.1,
    value: getVenue().projectors[0].viewer.positionM?.y ?? 3.5,
    onChange: (value) => writePosition("y", value),
  });
  const posZ = createNumberRow({
    label: "Z",
    suffix: " m",
    min: -40,
    max: 40,
    step: 0.1,
    value: getVenue().projectors[0].viewer.positionM?.z ?? 6,
    onChange: (value) => writePosition("z", value),
  });
  positionGrid.append(posX.row, posY.row, posZ.row);

  const fovSlider = createSliderRow({
    label: "Lamp FOV",
    min: 15,
    max: 90,
    step: 1,
    decimals: 0,
    suffix: "°",
    value: getVenue().projectors[0]?.fovDegrees ?? 40,
    onInput: (value) =>
      commitProjector((projector) => {
        projector.fovDegrees = value;
      }),
  });
  advanced.appendChild(fovSlider.row);

  const heightSlider = createSliderRow({
    label: "Height above box",
    min: -5,
    max: 25,
    step: 0.1,
    decimals: 1,
    suffix: " m",
    value: getVenue().projectors[0].viewer.heightM,
    onInput: (value) =>
      commitProjector((projector) => {
        projector.viewer.heightM = value;
        if (!projector.viewer.positionM) {
          syncViewerPositionFromPolar(projector.viewer);
        } else {
          projector.viewer.positionM.y = value;
          syncViewerPolarFromPosition(projector.viewer);
        }
        projector.azimuthDegrees = projector.viewer.azimuthDegrees;
      }),
  });
  advanced.appendChild(heightSlider.row);

  const faceStack = document.createElement("div");
  faceStack.className = "check-stack";
  advanced.appendChild(faceStack);

  const faceToggles = new Map();
  for (const faceId of FACE_IDS) {
    const toggle = createToggleRow({
      label: FACE_LABELS[faceId],
      checked: false,
      onChange: (checked) =>
        commitProjector((projector) => {
          const selected = new Set(projector.faceIds);
          if (checked) selected.add(faceId);
          else selected.delete(faceId);
          if (!selected.size) selected.add("top");
          projector.faceIds = FACE_IDS.filter((id) => selected.has(id));
        }),
    });
    faceToggles.set(faceId, toggle);
    faceStack.appendChild(toggle.row);
  }

  advanced.appendChild(
    createButtonRow([
      {
        label: "Look through lamp",
        onClick: () => onFrameActiveEye?.(),
      },
      {
        label: "Frame stage",
        onClick: () => onResetPreviewCamera?.(),
      },
    ])
  );

  container.appendChild(card);

  return {
    refresh() {
      const venue = normalizeVenueState(getVenue());
      enabledToggle.setValue(venue.enabled);
      outlineToggle.setValue(venue.showFaceOutlines);
      frustumToggle.setValue(venue.showFrustumHelpers);
      fullscreenToggle.setValue(venue.openFullscreenOnOutput !== false);
      boxWidth.setValue(venue.box.widthCm);
      boxDepth.setValue(venue.box.depthCm);
      boxHeight.setValue(venue.box.heightCm);
      if (
        venue.outputDisplayId &&
        [...outputDisplaySelect.select.options].some(
          (option) => option.value === venue.outputDisplayId
        )
      ) {
        outputDisplaySelect.setValue(venue.outputDisplayId);
      }

      projectorSelect.setOptions(
        venue.projectors.map((projector) => ({
          value: projector.id,
          label: projector.label,
        })),
        venue.activeProjectorId
      );

      const projector = getProjectorById(venue, venue.activeProjectorId);
      if (!projector) return;
      projectionModeSelect.setValue(
        projector.projectionMode === "anamorphic" ? "anamorphic" : "projector"
      );
      const position = projector.viewer.positionM || { x: 0, y: 0, z: 0 };
      posX.setValue(position.x);
      posY.setValue(position.y);
      posZ.setValue(position.z);
      fovSlider.setValue(projector.fovDegrees ?? 40);
      heightSlider.setValue(projector.viewer.heightM);
      for (const [faceId, toggle] of faceToggles) {
        toggle.setValue(projector.faceIds.includes(faceId));
      }
    },
  };
}
