interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps): JSX.Element {
  return <div className={`shimmer rounded-xl ${className ?? ''}`} />;
}
