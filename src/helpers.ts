export const attachVideo = (parent: HTMLDivElement | undefined, stream: MediaStream): void => {
  const vidElement = document.createElement('video');
  vidElement!.srcObject = stream;
  vidElement!.autoplay = true;
  parent?.appendChild(vidElement);
};

export const getRandomClientId = () => {
  return Math.random().toString(36).substring(2).toUpperCase();
};