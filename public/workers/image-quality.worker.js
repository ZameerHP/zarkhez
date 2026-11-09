/**
 * Dedicated Web Worker for OffscreenCanvas Image Quality Assessment
 * Computes Variance of the Laplacian, Mean Luminance, and Organ/Foliage ratio.
 */

self.onmessage = function (e) {
  const { data, width, height, id } = e.data;
  if (!data || !width || !height) {
    self.postMessage({ id, error: 'Invalid input data' });
    return;
  }

  const pixelCount = width * height;
  const gray = new Float32Array(pixelCount);
  let totalLuminance = 0;
  let foliagePixels = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[p] = y;
    totalLuminance += y;

    const isGreen = g > r * 0.95 && g > b * 1.05 && g > 30;
    const isYellowBrown =
      (r > 110 && g > 90 && b < 100 && Math.abs(r - g) < 60) ||
      (r > 70 && g > 40 && b < 65 && r > b * 1.15);
    const isLesionOrRoot =
      (r > 60 && g > 35 && b < 50) || (r > 140 && g > 50 && b < 60);

    if (isGreen || isYellowBrown || isLesionOrRoot) {
      foliagePixels++;
    }
  }

  const meanLuminance = totalLuminance / pixelCount;
  const subjectRatio = foliagePixels / pixelCount;

  // Laplacian computation
  let laplacianSum = 0;
  let laplacianCount = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 160));
  const tempLaplacian = [];

  for (let y = 1; y < height - 1; y += step) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x += step) {
      const c = gray[rowOffset + x];
      const up = gray[rowOffset - width + x];
      const down = gray[rowOffset + width + x];
      const left = gray[rowOffset + x - 1];
      const right = gray[rowOffset + x + 1];

      const lap = up + down + left + right - 4 * c;
      tempLaplacian.push(lap);
      laplacianSum += lap;
      laplacianCount++;
    }
  }

  let blurScore = 100;
  if (laplacianCount > 0) {
    const lapMean = laplacianSum / laplacianCount;
    let varianceSum = 0;
    for (let i = 0; i < tempLaplacian.length; i++) {
      const diff = tempLaplacian[i] - lapMean;
      varianceSum += diff * diff;
    }
    blurScore = Math.round(varianceSum / laplacianCount);
  }

  const isBlurry = blurScore < 28;
  const isDark = meanLuminance < 38;
  const isOverexposed = meanLuminance > 230;
  const isTooSmall = subjectRatio < 0.08;

  let score = 1.0;
  if (isBlurry) score -= 0.35;
  if (isDark || isOverexposed) score -= 0.35;
  if (isTooSmall) score -= 0.2;
  score = Math.max(0.1, Math.min(1.0, Number(score.toFixed(2))));

  self.postMessage({
    id,
    report: {
      isBlurry,
      isDark,
      isOverexposed,
      isTooSmall,
      blurScore,
      brightnessScore: Math.round(meanLuminance),
      subjectRatio: Number(subjectRatio.toFixed(3)),
      overallScore: score,
      isAcceptable: !isBlurry && !isDark && !isOverexposed && !isTooSmall,
    },
  });
};
