"use client";

import { useEffect, useRef } from "react";

/**
 * ParticleTextEffect — canvas-based animated particle text.
 *
 * Adapted from a 21st.dev component for inline use (footer / banner).
 * Differences from the original: dimensions + font are props (was hardcoded
 * 1000x500 + 100px Arial), and the full-page wrapper + helper text from
 * the original demo are removed — this component renders ONLY the canvas
 * so it can drop into any layout.
 *
 * Right-click and drag on the canvas to destroy particles (easter egg).
 * Words cycle every ~4 seconds (240 frames @ 60fps).
 */

interface Vector2D {
  x: number;
  y: number;
}

class Particle {
  pos: Vector2D = { x: 0, y: 0 };
  vel: Vector2D = { x: 0, y: 0 };
  acc: Vector2D = { x: 0, y: 0 };
  target: Vector2D = { x: 0, y: 0 };

  closeEnoughTarget = 100;
  maxSpeed = 1.0;
  maxForce = 0.1;
  particleSize = 10;
  pointSize = 2; /* MAKEOVER: per-particle dot size when drawAsPoints; set by host. */
  isKilled = false;

  startColor = { r: 0, g: 0, b: 0 };
  targetColor = { r: 0, g: 0, b: 0 };
  colorWeight = 0;
  colorBlendRate = 0.01;

  move() {
    let proximityMult = 1;
    const distance = Math.sqrt(
      Math.pow(this.pos.x - this.target.x, 2) + Math.pow(this.pos.y - this.target.y, 2)
    );

    if (distance < this.closeEnoughTarget) {
      proximityMult = distance / this.closeEnoughTarget;
    }

    const towardsTarget = {
      x: this.target.x - this.pos.x,
      y: this.target.y - this.pos.y,
    };

    const magnitude = Math.sqrt(towardsTarget.x * towardsTarget.x + towardsTarget.y * towardsTarget.y);
    if (magnitude > 0) {
      towardsTarget.x = (towardsTarget.x / magnitude) * this.maxSpeed * proximityMult;
      towardsTarget.y = (towardsTarget.y / magnitude) * this.maxSpeed * proximityMult;
    }

    const steer = {
      x: towardsTarget.x - this.vel.x,
      y: towardsTarget.y - this.vel.y,
    };

    const steerMagnitude = Math.sqrt(steer.x * steer.x + steer.y * steer.y);
    if (steerMagnitude > 0) {
      steer.x = (steer.x / steerMagnitude) * this.maxForce;
      steer.y = (steer.y / steerMagnitude) * this.maxForce;
    }

    this.acc.x += steer.x;
    this.acc.y += steer.y;

    this.vel.x += this.acc.x;
    this.vel.y += this.acc.y;
    this.pos.x += this.vel.x;
    this.pos.y += this.vel.y;
    this.acc.x = 0;
    this.acc.y = 0;
  }

  draw(ctx: CanvasRenderingContext2D, drawAsPoints: boolean) {
    if (this.colorWeight < 1.0) {
      this.colorWeight = Math.min(this.colorWeight + this.colorBlendRate, 1.0);
    }

    const currentColor = {
      r: Math.round(this.startColor.r + (this.targetColor.r - this.startColor.r) * this.colorWeight),
      g: Math.round(this.startColor.g + (this.targetColor.g - this.startColor.g) * this.colorWeight),
      b: Math.round(this.startColor.b + (this.targetColor.b - this.startColor.b) * this.colorWeight),
    };

    if (drawAsPoints) {
      ctx.fillStyle = `rgb(${currentColor.r}, ${currentColor.g}, ${currentColor.b})`;
      ctx.fillRect(this.pos.x, this.pos.y, this.pointSize, this.pointSize);
    } else {
      ctx.fillStyle = `rgb(${currentColor.r}, ${currentColor.g}, ${currentColor.b})`;
      ctx.beginPath();
      ctx.arc(this.pos.x, this.pos.y, this.particleSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  kill(width: number, height: number) {
    if (!this.isKilled) {
      const randomPos = this.generateRandomPos(width / 2, height / 2, (width + height) / 2);
      this.target.x = randomPos.x;
      this.target.y = randomPos.y;

      this.startColor = {
        r: this.startColor.r + (this.targetColor.r - this.startColor.r) * this.colorWeight,
        g: this.startColor.g + (this.targetColor.g - this.startColor.g) * this.colorWeight,
        b: this.startColor.b + (this.targetColor.b - this.startColor.b) * this.colorWeight,
      };
      this.targetColor = { r: 0, g: 0, b: 0 };
      this.colorWeight = 0;

      this.isKilled = true;
    }
  }

  private generateRandomPos(x: number, y: number, mag: number): Vector2D {
    const randomX = Math.random() * 1000;
    const randomY = Math.random() * 500;

    const direction = {
      x: randomX - x,
      y: randomY - y,
    };

    const magnitude = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    if (magnitude > 0) {
      direction.x = (direction.x / magnitude) * mag;
      direction.y = (direction.y / magnitude) * mag;
    }

    return {
      x: x + direction.x,
      y: y + direction.y,
    };
  }
}

export interface ParticleTextEffectProps {
  /** Words to cycle through (auto-advances every ~4 s). */
  words?: string[];
  /** Canvas width in CSS pixels. Sets both `canvas.width` and CSS width. @default 1000 */
  width?: number;
  /** Canvas height in CSS pixels. @default 500 */
  height?: number;
  /** Font size for the rendered word, in px. @default 100 */
  fontSize?: number;
  /** Font family. @default "Arial" */
  fontFamily?: string;
  /**
   * Fixed particle color as a `#rrggbb` hex string. If omitted, each word cycle
   * picks a random RGB (original 21st.dev behaviour).
   * @default undefined (random)
   */
  color?: string;
  /**
   * Sampling stride on the offscreen ImageData. Lower = denser particles
   * (more readable text), higher = sparser. Original demo used 6.
   * @default 6
   */
  pixelSteps?: number;
  /**
   * Side length of each drawn particle in px (when rendered as points).
   * Original demo used 2.
   * @default 2
   */
  pointSize?: number;
  /** Optional extra class names for the canvas. */
  className?: string;
  /** Optional inline style overrides for the canvas. */
  style?: React.CSSProperties;
}

/** Parse `#rrggbb` to an {r,g,b} object. Forgiving — handles missing `#`. */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

const DEFAULT_WORDS = ["HELLO", "21st.dev", "ParticleTextEffect", "BY", "KAINXU"];

export function ParticleTextEffect({
  words = DEFAULT_WORDS,
  width = 1000,
  height = 500,
  fontSize = 100,
  fontFamily = "Arial",
  color,
  pixelSteps = 6,
  pointSize = 2,
  className,
  style,
}: ParticleTextEffectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const particlesRef = useRef<Particle[]>([]);
  const frameCountRef = useRef(0);
  const wordIndexRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, isPressed: false, isRightClick: false });

  const drawAsPoints = true;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = width;
    canvas.height = height;

    const generateRandomPos = (x: number, y: number, mag: number): Vector2D => {
      const randomX = Math.random() * width;
      const randomY = Math.random() * height;
      const direction = { x: randomX - x, y: randomY - y };
      const magnitude = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
      if (magnitude > 0) {
        direction.x = (direction.x / magnitude) * mag;
        direction.y = (direction.y / magnitude) * mag;
      }
      return { x: x + direction.x, y: y + direction.y };
    };

    const nextWord = (word: string) => {
      const offscreenCanvas = document.createElement("canvas");
      offscreenCanvas.width = canvas.width;
      offscreenCanvas.height = canvas.height;
      const offscreenCtx = offscreenCanvas.getContext("2d")!;

      offscreenCtx.fillStyle = "white";
      offscreenCtx.font = `bold ${fontSize}px ${fontFamily}`;
      offscreenCtx.textAlign = "center";
      offscreenCtx.textBaseline = "middle";
      offscreenCtx.fillText(word, canvas.width / 2, canvas.height / 2);

      const imageData = offscreenCtx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;

      /* MAKEOVER: when `color` prop is supplied, lock particles to that hue
         (e.g. brand cyan #00d4ff). Otherwise the original random behaviour. */
      const newColor = color ? parseHexColor(color) : {
        r: Math.random() * 255,
        g: Math.random() * 255,
        b: Math.random() * 255,
      };

      const particles = particlesRef.current;
      let particleIndex = 0;

      const coordsIndexes: number[] = [];
      for (let i = 0; i < pixels.length; i += pixelSteps * 4) {
        coordsIndexes.push(i);
      }

      for (let i = coordsIndexes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [coordsIndexes[i], coordsIndexes[j]] = [coordsIndexes[j], coordsIndexes[i]];
      }

      for (const coordIndex of coordsIndexes) {
        const pixelIndex = coordIndex;
        const alpha = pixels[pixelIndex + 3];

        if (alpha > 0) {
          const x = (pixelIndex / 4) % canvas.width;
          const y = Math.floor(pixelIndex / 4 / canvas.width);

          let particle: Particle;

          if (particleIndex < particles.length) {
            particle = particles[particleIndex];
            particle.isKilled = false;
            particleIndex++;
          } else {
            particle = new Particle();
            const randomPos = generateRandomPos(canvas.width / 2, canvas.height / 2, (canvas.width + canvas.height) / 2);
            particle.pos.x = randomPos.x;
            particle.pos.y = randomPos.y;
            particle.maxSpeed = Math.random() * 6 + 4;
            particle.maxForce = particle.maxSpeed * 0.05;
            particle.particleSize = Math.random() * 6 + 6;
            particle.pointSize = pointSize; /* MAKEOVER: inherit dot size from the host prop */
            particle.colorBlendRate = Math.random() * 0.0275 + 0.0025;
            particles.push(particle);
          }

          particle.startColor = {
            r: particle.startColor.r + (particle.targetColor.r - particle.startColor.r) * particle.colorWeight,
            g: particle.startColor.g + (particle.targetColor.g - particle.startColor.g) * particle.colorWeight,
            b: particle.startColor.b + (particle.targetColor.b - particle.startColor.b) * particle.colorWeight,
          };
          particle.targetColor = newColor;
          particle.colorWeight = 0;

          particle.target.x = x;
          particle.target.y = y;
        }
      }

      for (let i = particleIndex; i < particles.length; i++) {
        particles[i].kill(canvas.width, canvas.height);
      }
    };

    const animate = () => {
      const ctx = canvas.getContext("2d")!;
      const particles = particlesRef.current;

      // Motion-blur background — gentle trail effect.
      ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        particle.move();
        particle.draw(ctx, drawAsPoints);

        if (particle.isKilled) {
          if (
            particle.pos.x < 0 ||
            particle.pos.x > canvas.width ||
            particle.pos.y < 0 ||
            particle.pos.y > canvas.height
          ) {
            particles.splice(i, 1);
          }
        }
      }

      if (mouseRef.current.isPressed && mouseRef.current.isRightClick) {
        particles.forEach((particle) => {
          const distance = Math.sqrt(
            Math.pow(particle.pos.x - mouseRef.current.x, 2) +
              Math.pow(particle.pos.y - mouseRef.current.y, 2)
          );
          if (distance < 50) {
            particle.kill(canvas.width, canvas.height);
          }
        });
      }

      frameCountRef.current++;
      if (frameCountRef.current % 240 === 0) {
        wordIndexRef.current = (wordIndexRef.current + 1) % words.length;
        nextWord(words[wordIndexRef.current]);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    // Initialize with first word, then start the loop.
    nextWord(words[0]);
    animate();

    const handleMouseDown = (e: MouseEvent) => {
      mouseRef.current.isPressed = true;
      mouseRef.current.isRightClick = e.button === 2;
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };
    const handleMouseUp = () => {
      mouseRef.current.isPressed = false;
      mouseRef.current.isRightClick = false;
    };
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };
    const handleContextMenu = (e: MouseEvent) => e.preventDefault();

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("contextmenu", handleContextMenu);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("contextmenu", handleContextMenu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, width, height, fontSize, fontFamily]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: "block", maxWidth: "100%", height: "auto", ...style }}
    />
  );
}

export default ParticleTextEffect;
