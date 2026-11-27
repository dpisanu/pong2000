import { useEffect, useState } from 'react';
import { DEFAULT_AVATAR_URL } from '../../shared/constants.ts';

interface AvatarImgProps {
  src: string;
  alt: string;
  className?: string;
  size?: number;
}

export function AvatarImg({ src, alt, className = '', size = 40 }: AvatarImgProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const resolvedSrc = failed || !src ? DEFAULT_AVATAR_URL : src;

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => {
        if (!failed) setFailed(true);
      }}
      className={`object-cover bg-slate-800 shrink-0 ${className}`}
    />
  );
}
