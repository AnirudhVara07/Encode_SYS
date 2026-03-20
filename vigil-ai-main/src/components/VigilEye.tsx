const VigilEye = ({ size = 120 }: { size?: number }) => {
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Pulse rings */}
      <div className="absolute inset-0 rounded-full border border-primary/30 animate-pulse-ring" />
      <div className="absolute inset-0 rounded-full border border-primary/20 animate-pulse-ring" style={{ animationDelay: '0.8s' }} />
      <div className="absolute inset-0 rounded-full border border-primary/10 animate-pulse-ring" style={{ animationDelay: '1.6s' }} />
      
      {/* Outer ring */}
      <div className="absolute rounded-full border-2 border-primary/40 animate-breathe"
        style={{ width: size * 0.8, height: size * 0.8 }} />
      
      {/* Inner glow */}
      <div className="absolute rounded-full bg-primary/20 animate-breathe"
        style={{ width: size * 0.5, height: size * 0.5, filter: 'blur(8px)' }} />
      
      {/* Core */}
      <div className="relative rounded-full bg-primary animate-breathe"
        style={{ width: size * 0.2, height: size * 0.2, boxShadow: '0 0 30px hsl(152 60% 50% / 0.6)' }} />
    </div>
  );
};

export default VigilEye;
