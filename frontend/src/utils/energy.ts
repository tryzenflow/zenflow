import { Scale } from "@/types/tasks";

interface EnergyStyle {
  textColor: string;
  backgroundColor: string;
}

export function getEnergyStyle(energy: Scale): EnergyStyle {
  switch (energy) {
    case 1:
      return { textColor: "text-lime-900", backgroundColor: "bg-lime-100" };
    case 2:
      return {
        textColor: "text-yellow-900",
        backgroundColor: "bg-yellow-100",
      };
    case 3:
      return {
        textColor: "text-orange-900",
        backgroundColor: "bg-orange-100",
      };
  }
}
