const $ = (id) => document.getElementById(id);
function render(state) {
  const configured = Boolean(state.configured);
  $("enrollment").classList.toggle("hidden", configured);
  $("status").textContent = state.automationActive ? "Automation active" : configured ? state.connected ? "Connected / idle" : "Disconnected" : "Not enrolled";
  $("message").textContent = state.message || "";
  $("active").classList.toggle("hidden", !state.automationActive);
}
$("enroll").addEventListener("click", async () => {
  $("message").textContent = "Enrolling…";
  try {
    await window.rasqDesktop.enroll({ controlUrl: $("url").value, enrollmentToken: $("token").value, name: $("name").value });
    $("token").value = "";
  } catch (e) { $("message").textContent = e instanceof Error ? e.message : String(e); }
  await refresh();
});
$("stop").addEventListener("click", () => window.rasqDesktop.stop());
window.rasqDesktop.onUpdate(render);
async function refresh() { render(await window.rasqDesktop.getState()); }
refresh();
