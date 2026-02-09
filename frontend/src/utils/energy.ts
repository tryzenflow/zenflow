import { Scale } from "@/types/tasks";

interface EnergyStyle {
  textColor: string;
  backgroundColor: string;
}

export function getEnergyStyle(energy: Scale): EnergyStyle {
  switch (energy) {
    case 1:
      return {
        textColor: "text-lime-900",
        backgroundColor: "bg-lime-100 hover:bg-lime-200",
      };
    case 2:
      return {
        textColor: "text-yellow-900",
        backgroundColor: "bg-yellow-100 hover:bg-yellow-200",
      };
    case 3:
      return {
        textColor: "text-orange-900",
        backgroundColor: "bg-orange-100 hover:bg-orange-200",
      };
  }
}
