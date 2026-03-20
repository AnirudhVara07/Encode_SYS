const Footer = () => (
  <footer className="border-t border-border/50 py-8 px-6">
    <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-primary animate-breathe" />
        <span className="font-medium text-foreground">Vigil</span>
      </div>
      <span className="font-mono text-xs">Built on Base · Secured by Civic</span>
    </div>
  </footer>
);

export default Footer;
