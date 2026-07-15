(() => {
  "use strict";

  const frame = document.querySelector(".recording-frame");
  const slides = Array.from(document.querySelectorAll(".slide"));
  const progressBar = document.getElementById("progress-bar");
  const currentLabel = document.getElementById("scene-current");
  const totalLabel = document.getElementById("scene-total");
  const elapsedLabel = document.getElementById("elapsed");
  const totalTimeLabel = document.getElementById("total-time");
  const playButton = document.getElementById("play-button");
  const prevButton = document.getElementById("prev-button");
  const nextButton = document.getElementById("next-button");
  const restartButton = document.getElementById("restart-button");
  const fullscreenButton = document.getElementById("fullscreen-button");
  const typingCode = document.getElementById("typing-code");
  const params = new URLSearchParams(window.location.search);

  const durations = slides.map((slide) => Number(slide.dataset.duration) || 5500);
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);
  const shouldLoop = params.get("loop") !== "0";
  let current = Math.min(Math.max(Number(params.get("slide")) || 0, 0), slides.length - 1);
  let playing = params.get("autoplay") !== "0";
  let sceneElapsed = 0;
  let previousTimestamp = performance.now();
  let animationFrame;
  let controlsTimer;
  let sceneTimers = [];

  const bibtexSample = `@article{vaswani2017attention,\n  title={Attention Is All You Need},\n  author={Vaswani, Ashish and Shazeer, Noam},\n  journal={Advances in Neural Information Processing Systems},\n  year={2017}\n}`;

  const formatTime = (milliseconds) => {
    const seconds = Math.floor(milliseconds / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };

  const clearSceneTimers = () => {
    sceneTimers.forEach(window.clearTimeout);
    sceneTimers = [];
  };

  const typeSample = () => {
    typingCode.textContent = "";
    let character = 0;
    const typeNext = () => {
      if (current !== 1 || character >= bibtexSample.length) return;
      const burst = bibtexSample[character] === "\n" ? 1 : Math.min(3, bibtexSample.length - character);
      typingCode.textContent += bibtexSample.slice(character, character + burst);
      character += burst;
      sceneTimers.push(window.setTimeout(typeNext, bibtexSample[character - 1] === "\n" ? 105 : 34));
    };
    sceneTimers.push(window.setTimeout(typeNext, 550));
  };

  const animateCounts = () => {
    document.querySelectorAll(".summary-chip b").forEach((counter, counterIndex) => {
      const target = Number(counter.dataset.count);
      counter.textContent = "0";
      for (let value = 1; value <= target; value += 1) {
        sceneTimers.push(window.setTimeout(() => {
          if (current === 3) counter.textContent = String(value);
        }, 450 + counterIndex * 130 + value * 65));
      }
    });
  };

  const animateDiffChoices = () => {
    const choices = Array.from(document.querySelectorAll(".slide-diff .value-pill.new"));
    choices.forEach((choice, index) => {
      choice.classList.toggle("selected", index === 0);
      const marker = choice.querySelector("span");
      if (marker) marker.textContent = index === 0 ? "✓" : "+";
    });
    choices.slice(1).forEach((choice, index) => {
      sceneTimers.push(window.setTimeout(() => {
        if (current !== 5) return;
        choice.classList.add("selected");
        choice.querySelector("span").textContent = "✓";
      }, 2200 + index * 650));
    });
  };

  const runSceneChoreography = () => {
    clearSceneTimers();
    if (current === 1) typeSample();
    if (current === 3) animateCounts();
    if (current === 5) animateDiffChoices();
  };

  const elapsedBeforeScene = (index) => durations.slice(0, index).reduce((sum, duration) => sum + duration, 0);

  const updateProgress = () => {
    const elapsed = elapsedBeforeScene(current) + sceneElapsed;
    progressBar.style.width = `${Math.min(100, (elapsed / totalDuration) * 100)}%`;
    elapsedLabel.textContent = formatTime(elapsed);
  };

  const showScene = (index, resetElapsed = true) => {
    current = (index + slides.length) % slides.length;
    if (resetElapsed) sceneElapsed = 0;

    slides.forEach((slide, slideIndex) => {
      slide.classList.remove("is-active", "is-before");
      slide.setAttribute("aria-hidden", "true");
      if (slideIndex < current) slide.classList.add("is-before");
    });

    // Force a style recalculation so each scene's CSS choreography replays.
    void slides[current].offsetWidth;
    slides[current].classList.add("is-active");
    slides[current].setAttribute("aria-hidden", "false");
    currentLabel.textContent = String(current + 1).padStart(2, "0");
    updateProgress();
    runSceneChoreography();
  };

  const setPlaying = (value) => {
    playing = value;
    playButton.classList.toggle("is-paused", !playing);
    playButton.setAttribute("aria-label", playing ? "Pause slideshow" : "Play slideshow");
    previousTimestamp = performance.now();
    if (!playing) {
      window.clearTimeout(controlsTimer);
      frame.classList.remove("controls-hidden");
    } else {
      showControlsTemporarily();
    }
  };

  const nextScene = () => {
    if (current === slides.length - 1 && !shouldLoop) {
      sceneElapsed = durations[current];
      setPlaying(false);
      updateProgress();
      return;
    }
    showScene((current + 1) % slides.length);
  };

  const previousScene = () => showScene((current - 1 + slides.length) % slides.length);

  const restart = () => {
    showScene(0);
    setPlaying(true);
  };

  const tick = (timestamp) => {
    const delta = Math.min(timestamp - previousTimestamp, 100);
    previousTimestamp = timestamp;

    if (playing) {
      sceneElapsed += delta;
      if (sceneElapsed >= durations[current]) nextScene();
      updateProgress();
    }

    animationFrame = window.requestAnimationFrame(tick);
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await frame.requestFullscreen();
      else await document.exitFullscreen();
    } catch (error) {
      console.warn("Fullscreen is unavailable in this browser.", error);
    }
  };

  const showControlsTemporarily = () => {
    if (params.get("controls") === "0") return;
    frame.classList.remove("controls-hidden");
    window.clearTimeout(controlsTimer);
    if (!playing) return;
    controlsTimer = window.setTimeout(() => frame.classList.add("controls-hidden"), 2200);
  };

  playButton.addEventListener("click", () => setPlaying(!playing));
  prevButton.addEventListener("click", previousScene);
  nextButton.addEventListener("click", nextScene);
  restartButton.addEventListener("click", restart);
  fullscreenButton.addEventListener("click", toggleFullscreen);

  document.addEventListener("keydown", (event) => {
    if (["INPUT", "TEXTAREA", "BUTTON", "A"].includes(document.activeElement?.tagName)) return;
    if (event.code === "Space") {
      event.preventDefault();
      setPlaying(!playing);
    } else if (event.key === "ArrowLeft") {
      previousScene();
    } else if (event.key === "ArrowRight") {
      nextScene();
    } else if (event.key.toLowerCase() === "r") {
      restart();
    } else if (event.key.toLowerCase() === "f") {
      toggleFullscreen();
    }
    showControlsTemporarily();
  });

  document.addEventListener("mousemove", showControlsTemporarily);
  document.addEventListener("fullscreenchange", () => {
    fullscreenButton.setAttribute("aria-label", document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen");
  });
  document.addEventListener("visibilitychange", () => {
    previousTimestamp = performance.now();
  });

  totalLabel.textContent = String(slides.length).padStart(2, "0");
  totalTimeLabel.textContent = formatTime(totalDuration);
  playButton.classList.toggle("is-paused", !playing);
  playButton.setAttribute("aria-label", playing ? "Pause slideshow" : "Play slideshow");
  if (params.get("controls") === "0") frame.classList.add("controls-hidden");
  showScene(current);
  showControlsTemporarily();
  animationFrame = window.requestAnimationFrame(tick);

  window.addEventListener("beforeunload", () => {
    window.cancelAnimationFrame(animationFrame);
    clearSceneTimers();
  });
})();
