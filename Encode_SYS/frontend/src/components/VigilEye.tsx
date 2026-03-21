const LOGO_SRC = "/vigil-logo.png";

const VigilEye = ({ size = 120 }: { size?: number }) => {
  return (
    <div
      className="relative flex shrink-0 items-center justify-center rounded-full animate-breathe shadow-lg ring-2 ring-primary/25 ring-offset-2 ring-offset-background"
      style={{ width: size, height: size }}
    >
      <img
        src={LOGO_SRC}
        alt=""
        width={size}
        height={size}
        className="h-full w-full rounded-full object-cover"
        decoding="async"
      />
    </div>
  );
};

export default VigilEye;
