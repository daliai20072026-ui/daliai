const $ = (id) => document.getElementById(id);

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Instagram request failed.");
  return data;
}

function setStatus(connected, text) {
  const dot = $("dot");
  const status = $("status");
  if (dot) dot.classList.toggle("ok", !!connected);
  if (status) status.textContent = text;
}

async function refreshStatus() {
  try {
    const data = await readJson(await fetch("/api/instagram/status", {
      credentials: "same-origin",
      cache: "no-store"
    }));
    if (data.connected) {
      setStatus(true, "Instagram connected");
      $("account").textContent = data.username ? "@" + data.username : "Your Instagram Professional account is connected.";
      $("publish").disabled = false;
      const automation = $("automationStatus");
      if (data.daily_ready) {
        automation.textContent = "Daily auto-post ready · 09:00 UTC · " + data.daily_image_count + " image source(s)";
        automation.classList.add("ready");
      } else if (!data.persistent_storage) {
        automation.textContent = "Setup needed: connect Redis for secure daily automation";
        automation.classList.remove("ready");
      } else if (!data.daily_image_count) {
        automation.textContent = "Setup needed: add a public HTTPS image URL";
        automation.classList.remove("ready");
      } else if (!data.auto_post_enabled) {
        automation.textContent = "Daily posting is OFF · enable INSTAGRAM_AUTO_POST_ENABLED";
        automation.classList.remove("ready");
      } else {
        automation.textContent = "Daily automation needs configuration";
        automation.classList.remove("ready");
      }
      $("connectBox").hidden = true;
    } else {
      setStatus(false, data.configured ? "Not connected" : "Agent needs configuration");
      $("account").textContent = data.error || "Connect your Instagram account to continue.";
      $("publish").disabled = true;
      $("automationStatus").textContent = "Automation not connected";
    }
  } catch (error) {
    setStatus(false, "Connection check failed");
    $("account").textContent = error.message;
    $("publish").disabled = true;
  }
}

$("connect")?.addEventListener("click", () => {
  const key = $("ownerKey")?.value.trim();
  if (!key) {
    $("account").textContent = "Enter your private owner key first.";
    return;
  }
  const url = "/api/instagram/connect?key=" + encodeURIComponent(key);
  window.location.assign(url);
});

$("publish")?.addEventListener("click", async () => {
  const button = $("publish");
  const result = $("result");
  const imageUrl = $("imageUrl")?.value.trim();
  const caption = $("caption")?.value.trim();

  if (!imageUrl) {
    result.textContent = "Add a public HTTPS image URL.";
    return;
  }

  button.disabled = true;
  result.textContent = "Publishing…";

  try {
    const data = await readJson(await fetch("/api/instagram/publish", {
      method: "POST",
      credentials: "same-origin",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({image_url: imageUrl, caption})
    }));
    result.textContent = "Published successfully.";
    if (data.caption && !$("caption").value.trim()) $("caption").value = data.caption;
  } catch (error) {
    result.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

refreshStatus();