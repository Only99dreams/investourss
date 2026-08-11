import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-muted">
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h1 className="mb-2 text-4xl font-bold">Coming Soon</h1>
          <p className="mb-6 text-lg text-muted-foreground">This page is not available yet.</p>
          <a href="/" className="text-primary underline hover:text-primary/90">
            Return to Home
          </a>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
