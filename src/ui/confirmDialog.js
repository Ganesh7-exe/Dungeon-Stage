/**
 * Small in-app confirm dialog (Confirm / Cancel) for actions where native
 * browser confirm is unreliable (e.g. nested controls, Electron).
 */
export function confirmRemoveMap(message = "Remove map?") {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "confirm-dialog-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "confirm-dialog";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "confirm-dialog-message");

    const messageElement = document.createElement("p");
    messageElement.id = "confirm-dialog-message";
    messageElement.className = "confirm-dialog-message";
    messageElement.textContent = message;

    const actions = document.createElement("div");
    actions.className = "confirm-dialog-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "confirm-dialog-button confirm-dialog-button--cancel";
    cancelButton.textContent = "Cancel";

    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "confirm-dialog-button confirm-dialog-button--confirm";
    confirmButton.textContent = "Confirm";

    const finish = (confirmed) => {
      window.removeEventListener("keydown", onKeyDown);
      backdrop.remove();
      resolve(confirmed);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };

    cancelButton.addEventListener("click", () => finish(false));
    confirmButton.addEventListener("click", () => finish(true));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) finish(false);
    });

    actions.appendChild(cancelButton);
    actions.appendChild(confirmButton);
    dialog.appendChild(messageElement);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    window.addEventListener("keydown", onKeyDown);
    confirmButton.focus();
  });
}
