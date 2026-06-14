import { Link } from "react-router-dom";
import { Twitter, Mail, MapPin, Instagram, Youtube, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="py-12 border-t border-border bg-secondary/30">
      <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-3 gap-8 mb-8">
          {/* Company Info */}
          <div>
            <h3 className="font-semibold text-foreground mb-4">Investours</h3>
            <p className="text-sm text-muted-foreground mb-4">
             Building financial futures with confidence through AI tools, education, community, and mentorship.
            </p>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                <span>admin@investours.app</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                <span>Nigeria</span>
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold text-foreground mb-4">Quick Links</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/home" className="text-muted-foreground hover:text-primary transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/community" className="text-muted-foreground hover:text-primary transition-colors">
                  Community
                </Link>
              </li>
              <li>
                <Link to="/learning" className="text-muted-foreground hover:text-primary transition-colors">
                  Learning
                </Link>
              </li>
              <li>
                <Link to="/vetting" className="text-muted-foreground hover:text-primary transition-colors">
                  Scam Detector
                </Link>
              </li>
              <li>
                <Link to="/auth?mode=login" className="text-muted-foreground hover:text-primary transition-colors">
                  Login
                </Link>
              </li>
              <li>
                <Link to="/signup" className="text-muted-foreground hover:text-primary transition-colors">
                  Sign Up
                </Link>
              </li>
            </ul>
          </div>

          {/* Social Media */}
          <div>
            <h3 className="font-semibold text-foreground mb-4">Connect With Us</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Follow us on social media for the latest updates and financial tips.
            </p>
            <div className="flex gap-2 flex-wrap">
              <a href="https://x.com/Investoursworld" target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="icon" className="hover:text-primary">
                  <Twitter className="w-5 h-5" />
                  <span className="sr-only">X (Twitter)</span>
                </Button>
              </a>
              <a href="https://www.instagram.com/investoursworld/" target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="icon" className="hover:text-primary">
                  <Instagram className="w-5 h-5" />
                  <span className="sr-only">Instagram</span>
                </Button>
              </a>
              <a href="https://chat.whatsapp.com/Go5HpKeLiqz5NpPWLcVy1Q" target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="icon" className="hover:text-primary">
                  <MessageCircle className="w-5 h-5" />
                  <span className="sr-only">WhatsApp</span>
                </Button>
              </a>
              <a href="https://www.youtube.com/@Investoursworld" target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="icon" className="hover:text-primary">
                  <Youtube className="w-5 h-5" />
                  <span className="sr-only">YouTube</span>
                </Button>
              </a>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-8 text-center text-sm text-muted-foreground">
          <p>© {currentYear} Investours. All rights reserved. <br/>
          
          
          
         Disclaimer: Investours does not provide financial or investment advice. AI insights are for education and risk awareness only.
          
          
          
          </p>
        </div>
      </div>
    </footer>
  );
}
