import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Settings as SettingsIcon } from "lucide-react";

interface SystemSetting {
  key: string;
  value: string;
}

const SettingsTab = () => {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("system_settings")
        .select("*")
        .order("key");

      if (error) throw error;
      setSettings(data || []);
    } catch (error) {
      console.error("Error fetching settings:", error);
      toast({
        title: "Error",
        description: "Failed to load settings",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = async (key: string, value: string) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("system_settings")
        .upsert({
          key,
          value,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Setting updated successfully"
      });

      fetchSettings();
    } catch (error) {
      console.error("Error updating setting:", error);
      toast({
        title: "Error",
        description: "Failed to update setting",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSettingChange = (key: string, value: string) => {
    setSettings(prev =>
      prev.map(setting =>
        setting.key === key ? { ...setting, value } : setting
      )
    );
  };

  const commissionSettings = settings.filter(setting =>
    setting.key.includes('commission') || setting.key.includes('withdrawal_fee')
  );

  const otherSettings = settings.filter(setting =>
    !setting.key.includes('commission')
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Commission Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="w-5 h-5" />
            Referral Commission Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {commissionSettings.map((setting) => (
            <div key={setting.key} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              <div>
                <Label className="text-sm font-medium">
                  {setting.key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {setting.key.includes('direct') ? 'Direct referral commissions' :
                   setting.key.includes('indirect') ? 'Indirect referral commissions' :
                   'Commission percentage'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={setting.value}
                  onChange={(e) => handleSettingChange(setting.key, e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
              <Button
                onClick={() => updateSetting(setting.key, setting.value)}
                disabled={saving}
                size="sm"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Other Settings */}
      {otherSettings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Other Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {otherSettings.map((setting) => (
              <div key={setting.key} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                <div>
                  <Label className="text-sm font-medium">
                    {setting.key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </Label>
                </div>
                <Input
                  value={setting.value}
                  onChange={(e) => handleSettingChange(setting.key, e.target.value)}
                />
                <Button
                  onClick={() => updateSetting(setting.key, setting.value)}
                  disabled={saving}
                  size="sm"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Update"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SettingsTab;