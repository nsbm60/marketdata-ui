// src/components/shared/TabButtonGroup.tsx
import type React from "react";

interface Tab {
  id: string;
  label: string;
}

interface TabButtonGroupProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

const baseStyle: React.CSSProperties = {
  padding: "4px 12px",
  border: "1px solid #d1d5db",
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
};

/**
 * A segmented button group for tab navigation.
 * Displays buttons side-by-side with rounded corners on the ends.
 */
export default function TabButtonGroup({
  tabs,
  activeTab,
  onTabChange,
}: TabButtonGroupProps) {
  return (
    <div style={{ display: "flex", gap: 0 }}>
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTab;
        const isFirst = index === 0;
        const isLast = index === tabs.length - 1;

        const style: React.CSSProperties = {
          ...baseStyle,
          background: isActive ? "#2563eb" : "white",
          color: isActive ? "white" : "#374151",
          borderRadius: isFirst
            ? "4px 0 0 4px"
            : isLast
              ? "0 4px 4px 0"
              : "0",
          // Remove right border except on last button to avoid double borders
          borderRight: isLast ? "1px solid #d1d5db" : "none",
        };

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={style}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
