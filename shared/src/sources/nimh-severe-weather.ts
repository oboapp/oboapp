import type { SourceDefinition } from "../source-definition";

const nimhSevereWeather: SourceDefinition = {
  id: "nimh-severe-weather",
  url: "https://weather.bg/obshtini/index.php?z=u&o=SOF",
  name: "НИМХ - Опасно време",
  localities: ["bg.sofia"],
};

export default nimhSevereWeather;
