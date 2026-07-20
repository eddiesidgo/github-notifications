(() => {
  let current = null;

  window.notificationSound.onPlay((url) => {
    try {
      if (current) {
        current.pause();
        current = null;
      }
      current = new Audio(url);
      current.volume = 1;
      current.play().catch((err) => {
        console.error('Audio play failed', err);
      });
    } catch (err) {
      console.error(err);
    }
  });
})();
