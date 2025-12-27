// Example client-side script

document.addEventListener("DOMContentLoaded", () => {
  console.log("Pick Builder Example loaded!");

  // Add click handlers to API links for demo
  document.querySelectorAll('a[href^="/api"]').forEach((link) => {
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      const url = link.getAttribute("href");

      try {
        const res = await fetch(url);
        const data = await res.json();
        alert(JSON.stringify(data, null, 2));
      } catch (err) {
        alert("Error: " + err.message);
      }
    });
  });
});
