/**
 * Small factories for the control-panel widgets.
 *
 * Every panel here needs the same label/input/readout arrangement, so the
 * markup lives in one place and reuses the existing stylesheet classes rather
 * than each panel hand-rolling its own DOM.
 */

export function createCard({ title, badge = "", kicker = "" }) {
  const card = document.createElement("section");
  card.className = "card";

  const head = document.createElement("div");
  head.className = "card-head";

  const heading = document.createElement("h3");
  heading.textContent = title;
  head.appendChild(heading);

  if (badge) {
    const badgeElement = document.createElement("span");
    badgeElement.className = "badge";
    badgeElement.textContent = badge;
    head.appendChild(badgeElement);
  }

  card.appendChild(head);

  if (kicker) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = kicker;
    card.appendChild(hint);
  }

  return { card, head };
}

export function createSliderRow({
  label,
  min,
  max,
  step,
  value,
  decimals = 2,
  suffix = "",
  onInput,
}) {
  const row = document.createElement("label");
  row.className = "field";

  const labelElement = document.createElement("span");
  labelElement.className = "field-label";
  labelElement.textContent = `${label} `;

  const output = document.createElement("output");
  labelElement.appendChild(output);
  row.appendChild(labelElement);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  row.appendChild(input);

  const renderOutput = () => {
    output.textContent = `${Number(input.value).toFixed(decimals)}${suffix}`;
  };
  renderOutput();

  input.addEventListener("input", () => {
    renderOutput();
    onInput?.(Number(input.value));
  });

  return {
    row,
    input,
    setValue(nextValue) {
      input.value = String(nextValue);
      renderOutput();
    },
  };
}

export function createToggleRow({ label, checked, onChange }) {
  const row = document.createElement("label");
  row.className = "row";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  row.appendChild(input);

  const text = document.createElement("span");
  text.textContent = label;
  row.appendChild(text);

  input.addEventListener("change", () => onChange?.(input.checked));

  return {
    row,
    input,
    setValue(nextChecked) {
      input.checked = Boolean(nextChecked);
    },
  };
}

export function createNumberRow({
  label,
  min,
  max,
  step = 1,
  value,
  suffix = "",
  onChange,
}) {
  const row = document.createElement("label");
  row.className = "field";

  const labelElement = document.createElement("span");
  labelElement.className = "field-label";
  labelElement.textContent = suffix ? `${label} (${suffix})` : label;
  row.appendChild(labelElement);

  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  row.appendChild(input);

  const commit = () => {
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) return;
    onChange?.(Math.min(max, Math.max(min, parsed)));
  };
  input.addEventListener("change", commit);

  return {
    row,
    input,
    setValue(nextValue) {
      input.value = String(nextValue);
    },
  };
}

export function createSelectRow({ label, options, value, onChange }) {
  const row = document.createElement("label");
  row.className = "field";

  const labelElement = document.createElement("span");
  labelElement.className = "field-label";
  labelElement.textContent = label;
  row.appendChild(labelElement);

  const select = document.createElement("select");
  for (const option of options) {
    const optionElement = document.createElement("option");
    optionElement.value = option.value;
    optionElement.textContent = option.label;
    select.appendChild(optionElement);
  }
  select.value = value;
  row.appendChild(select);

  select.addEventListener("change", () => onChange?.(select.value));

  return {
    row,
    select,
    setOptions(nextOptions, nextValue) {
      select.innerHTML = "";
      for (const option of nextOptions) {
        const optionElement = document.createElement("option");
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        select.appendChild(optionElement);
      }
      select.value = nextValue;
    },
    setValue(nextValue) {
      select.value = nextValue;
    },
  };
}

export function createColorRow({ label, value, onChange }) {
  const row = document.createElement("label");
  row.className = "field";

  const labelElement = document.createElement("span");
  labelElement.className = "field-label";
  labelElement.textContent = label;
  row.appendChild(labelElement);

  const input = document.createElement("input");
  input.type = "color";
  input.value = value;
  row.appendChild(input);

  input.addEventListener("input", () => onChange?.(input.value));

  return {
    row,
    input,
    setValue(nextValue) {
      input.value = nextValue;
    },
  };
}

export function createButtonRow(buttons) {
  const row = document.createElement("div");
  row.className = "btn-row";
  for (const definition of buttons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = definition.className || "btn btn-ghost";
    button.textContent = definition.label;
    if (definition.id) button.id = definition.id;
    button.addEventListener("click", () => definition.onClick?.());
    row.appendChild(button);
  }
  return row;
}
