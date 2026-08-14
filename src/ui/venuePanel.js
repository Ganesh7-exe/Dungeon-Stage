import {
  createButtonRow,
  createCard,
  createNumberRow,
  createSelectRow,
  createToggleRow,
} from "./controlBuilders.js";
import {
  normalizeVenueState,
} from "../venueGeometry.js";
import { listProjectorOutputDisplays } from "../displayOutput.js";

/**
 * Real-life box projection setup:
 * 1) Match physical box size
 * 2) Align corners in Mapping Studio / projector feed
 */

export function createVenuePanel({
  container,
  getVenue,
  onChange,
  onOpenProjectorWindow,
  onOpenMappingStudio,
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

  container.appendChild(card);

  return {
    refresh() {
      const venue = normalizeVenueState(getVenue());
      enabledToggle.setValue(venue.enabled);
      outlineToggle.setValue(venue.showFaceOutlines);
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
    },
  };
}
