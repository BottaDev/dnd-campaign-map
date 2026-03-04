export function renderCharacterToggles(characters, onToggle) {
  const root = document.getElementById("characterToggles");
  root.querySelectorAll(".toggle").forEach(n => n.remove());

  characters.forEach(c => {
    const row = document.createElement("label");
    row.className = "toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = c.enabled;
    input.addEventListener("change", () => onToggle(c.id, input.checked));

    const swatch = document.createElement("span");
    swatch.style.width = "10px";
    swatch.style.height = "10px";
    swatch.style.borderRadius = "999px";
    swatch.style.display = "inline-block";
    swatch.style.background = c.color;

    const name = document.createElement("span");
    name.textContent = c.name;

    row.appendChild(input);
    row.appendChild(swatch);
    row.appendChild(name);

    root.appendChild(row);
  });
}

export function fillFilterDropdowns(characters, tags) {
  const charSel = document.getElementById("filterCharacter");
  charSel.innerHTML = "";
  charSel.appendChild(new Option("All", ""));
  characters.forEach(c => charSel.appendChild(new Option(c.name, c.id)));

  const tagSel = document.getElementById("filterTag");
  tagSel.innerHTML = "";
  tagSel.appendChild(new Option("All", ""));
  tags.forEach(t => tagSel.appendChild(new Option(t, t)));
}

export function renderEventsList(events, onEventClick) {
  const list = document.getElementById("eventsList");
  list.innerHTML = "";

  events.forEach(ev => {
    const li = document.createElement("li");
    li.className = "event";
    li.innerHTML = `
      <div class="meta">${ev.date} · Session #${ev.session}</div>
      <div class="title">${ev.title}</div>
      <div class="small">${ev.summary}</div>
    `;
    li.addEventListener("click", () => onEventClick(ev));
    list.appendChild(li);
  });

  const rc = document.getElementById("resultsCount");
  rc.textContent = `${events.length} events shown`;
}

export function wireFilterInputs(onChange) {
  [
    "filterText",
    "filterCharacter",
    "filterTag",
    "filterFrom",
    "filterTo",
    "filterSessionMin",
    "filterSessionMax",
  ].forEach(id => {
    document.getElementById(id).addEventListener("input", onChange);
    document.getElementById(id).addEventListener("change", onChange);
  });

  document.getElementById("resetFilters").addEventListener("click", () => {
    document.getElementById("filterText").value = "";
    document.getElementById("filterCharacter").value = "";
    document.getElementById("filterTag").value = "";
    document.getElementById("filterFrom").value = "";
    document.getElementById("filterTo").value = "";
    document.getElementById("filterSessionMin").value = "";
    document.getElementById("filterSessionMax").value = "";
    onChange();
  });
}