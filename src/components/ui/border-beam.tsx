"use client";

import { motion, type MotionStyle, type Transition } from "motion/react";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

interface BorderBeamProps {
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
  transition?: Transition;
  className?: string;
  style?: CSSProperties;
  reverse?: boolean;
  initialOffset?: number;
  borderWidth?: number;
}

// Magic UI Border Beam: https://magicui.design/docs/components/border-beam
// Inline mask and gradient styles support this app's Tailwind 3 setup.
export const BorderBeam = ({
  className,
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = "#ffaa40",
  colorTo = "#9c40ff",
  transition,
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1
}: BorderBeamProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [legacyPath, setLegacyPath] = useState<string>();

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element || CSS.supports("offset-path", "rect(0 auto auto 0 round 1px)")) return;

    // Safari 16 supports path(), but rect() motion paths require Safari 17.2.
    const updatePath = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      const radius = Math.min(
        Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
        width / 2,
        height / 2
      );
      setLegacyPath(
        `path("M ${radius} 0 H ${width - radius} Q ${width} 0 ${width} ${radius} V ${height - radius} Q ${width} ${height} ${width - radius} ${height} H ${radius} Q 0 ${height} 0 ${height - radius} V ${radius} Q 0 0 ${radius} 0 Z")`
      );
    };
    updatePath();
    const observer = new ResizeObserver(updatePath);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-solid border-transparent"
      ref={containerRef}
      style={
        {
          borderWidth,
          maskImage: "linear-gradient(transparent, transparent), linear-gradient(#000, #000)",
          maskComposite: "intersect",
          maskClip: "padding-box, border-box",
          WebkitMaskImage: "linear-gradient(#000, #000), linear-gradient(#000, #000)",
          WebkitMaskClip: "padding-box, border-box",
          WebkitMaskComposite: "xor"
        } as CSSProperties
      }
    >
      <motion.div
        className={`absolute aspect-square ${className ?? ""}`}
        style={
          {
            width: size,
            background: `linear-gradient(to left, ${colorFrom}, ${colorTo}, transparent)`,
            offsetPath: legacyPath ?? `rect(0 auto auto 0 round ${size}px)`,
            "--color-from": colorFrom,
            "--color-to": colorTo,
            ...style
          } as MotionStyle
        }
        initial={{ offsetDistance: `${initialOffset}%` }}
        animate={{
          offsetDistance: reverse
            ? [`${100 - initialOffset}%`, `${-initialOffset}%`]
            : [`${initialOffset}%`, `${100 + initialOffset}%`]
        }}
        transition={{
          repeat: Infinity,
          ease: "linear",
          duration,
          delay: -delay,
          ...transition
        }}
      />
    </div>
  );
};
