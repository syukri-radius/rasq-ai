document.getElementById("run").addEventListener("click", () => {
  const name = document.getElementById("name").value;
  const role = document.getElementById("role").value;
  const confirmed = document.getElementById("check").checked;
  document.getElementById("result").textContent = `Observed synthetic action at ${new Date().toISOString()}: ${name}, ${role}, confirmed=${confirmed}.`;
});
