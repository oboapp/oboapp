import type { Message } from "@oboapp/shared";

const SOFIA_LOCALITY = "bg.sofia";

const iso = (value: string): string => new Date(value).toISOString();
const messageTimes = (
  createdAt: string,
  finalizedAt: string,
  timespan?: { start: string; end: string },
) => ({
  createdAt: iso(createdAt),
  finalizedAt: iso(finalizedAt),
  ...(timespan
    ? {
        timespanStart: iso(timespan.start),
        timespanEnd: iso(timespan.end),
      }
    : {}),
});

const pointGeometry = (lng: number, lat: number) => ({
  type: "Point" as const,
  coordinates: [lng, lat] as [number, number],
});

const pointFeature = (lng: number, lat: number) => ({
  type: "Feature" as const,
  geometry: pointGeometry(lng, lat),
  properties: {},
});

const lineFeature = (coordinates: [number, number][]) => ({
  type: "Feature" as const,
  geometry: {
    type: "LineString" as const,
    coordinates,
  },
  properties: {},
});

const featureCollection = (
  features: Array<
    ReturnType<typeof pointFeature> | ReturnType<typeof lineFeature>
  >,
) => ({
  type: "FeatureCollection" as const,
  features,
});

/**
 * Static fixtures for messages
 * ~20 messages covering all categories, mixed locations (clustered + scattered)
 */
export const MOCK_MESSAGES: Message[] = [
  // Cluster 1: City center (around 42.6977, 23.3219)
  {
    locality: SOFIA_LOCALITY,
    id: "msg-water-center-1",
    text: "Планирано спиране на водоподаването на ул. Граф Игнатиев от No 5 до No 25",
    plainText:
      "Планирано спиране на водоподаването на ул. Граф Игнатиев от No 5 до No 25",
    markdownText:
      "**Планирано спиране** на водоподаването на **ул. Граф Игнатиев** от No 5 до No 25",
    categories: ["water"],
    ...messageTimes("2026-02-09T08:00:00Z", "2026-02-09T08:05:00Z", {
      start: "2026-02-10T09:00:00Z",
      end: "2026-02-10T17:00:00Z",
    }),
    source: "sofiyska-voda",
    sourceUrl: "https://www.sofiyskavoda.bg",
    responsibleEntity: "Софийска вода",
    streets: [
      {
        street: "ул. Граф Игнатиев",
        from: "No 5",
        to: "No 25",
        timespans: [
          {
            start: "10.02.2026 09:00",
            end: "10.02.2026 17:00",
          },
        ],
      },
    ],
    geoJson: featureCollection([
      lineFeature([
        [23.3205, 42.6965],
        [23.3225, 42.6975],
      ]),
    ]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-construction-center-2",
    text: "Ремонт на тротоара на бул. Витоша между ул. Московска и ул. Алабин",
    plainText:
      "Ремонт на тротоара на бул. Витоша между ул. Московска и ул. Алабин",
    markdownText:
      "# Ремонт на тротоар\n\n**Локация:** бул. Витоша между ул. Московска и ул. Алабин\n\n**Период:** 08.02.2026 - 20.02.2026",
    categories: ["construction-and-repairs"],
    ...messageTimes("2026-02-08T10:00:00Z", "2026-02-08T10:10:00Z", {
      start: "2026-02-08T00:00:00Z",
      end: "2026-02-20T23:59:59Z",
    }),
    source: "sofia-bg",
    sourceUrl: "https://www.sofia.bg",
    responsibleEntity: "Столична община",
    addresses: [
      {
        originalText: "бул. Витоша",
        formattedAddress: "бул. Витоша, София",
        coordinates: { lat: 42.6975, lng: 23.3205 },
        geoJson: pointGeometry(23.3205, 42.6975),
      },
    ],
    streets: [
      {
        street: "бул. Витоша",
        from: "ул. Московска",
        to: "ул. Алабин",
        timespans: [
          {
            start: "08.02.2026 00:00",
            end: "20.02.2026 23:59",
          },
        ],
      },
    ],
    geoJson: featureCollection([
      lineFeature([
        [23.3195, 42.6955],
        [23.3215, 42.6985],
      ]),
    ]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-public-transport-center-3",
    text: "Промяна в движението на трамваи №10 и №12 поради ремонт на релсите на бул. Христо Ботев",
    plainText:
      "Промяна в движението на трамваи №10 и №12 поради ремонт на релсите на бул. Христо Ботев",
    categories: ["public-transport", "traffic"],
    ...messageTimes("2026-02-09T14:00:00Z", "2026-02-09T14:15:00Z", {
      start: "2026-02-10T06:00:00Z",
      end: "2026-02-15T22:00:00Z",
    }),
    source: "sofia-bg",
    responsibleEntity: "ЦГМ",
    geoJson: featureCollection([
      lineFeature([
        [23.315, 42.7],
        [23.32, 42.705],
      ]),
    ]),
  },

  // Cluster 2: Mladost district (east, around 42.65, 23.38)
  {
    locality: SOFIA_LOCALITY,
    id: "msg-heating-mladost-1",
    text: "Авария на топлопровод в ж.к. Младост 1, блокове 40-50",
    plainText: "Авария на топлопровод в ж.к. Младост 1, блокове 40-50",
    categories: ["heating"],
    ...messageTimes("2026-02-09T06:30:00Z", "2026-02-09T06:45:00Z", {
      start: "2026-02-09T06:00:00Z",
      end: "2026-02-10T12:00:00Z",
    }),
    source: "toplo-bg",
    sourceUrl: "https://www.toplo.bg",
    responsibleEntity: "Топлофикация София",
    geoJson: featureCollection([pointFeature(23.38, 42.65)]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-waste-mladost-2",
    text: "Почистване на контейнери за смет в района на бул. Александър Малинов",
    plainText:
      "Почистване на контейнери за смет в района на бул. Александър Малинов",
    categories: ["waste"],
    ...messageTimes("2026-02-08T16:00:00Z", "2026-02-08T16:10:00Z", {
      start: "2026-02-11T07:00:00Z",
      end: "2026-02-11T15:00:00Z",
    }),
    source: "mladost-bg",
    responsibleEntity: "Район Младост",
    geoJson: featureCollection([
      lineFeature([
        [23.375, 42.648],
        [23.385, 42.652],
      ]),
    ]),
  },

  // Scattered messages across Sofia
  {
    locality: SOFIA_LOCALITY,
    id: "msg-electricity-lozenets-1",
    text: "Планирано прекъсване на електрозахранването в района на ул. Кричим и ул. Гоце Делчев",
    plainText:
      "Планирано прекъсване на електрозахранването в района на ул. Кричим и ул. Гоце Делчев",
    markdownText:
      "# Прекъсване на ток\n\n**Локация:** ул. Кричим и ул. Гоце Делчев\n\n**Дата:** 12.02.2026\n\n**Време:** 08:00 - 14:00",
    categories: ["electricity"],
    ...messageTimes("2026-02-07T12:00:00Z", "2026-02-07T12:15:00Z", {
      start: "2026-02-12T08:00:00Z",
      end: "2026-02-12T14:00:00Z",
    }),
    source: "erm-zapad",
    sourceUrl: "https://www.cez.bg",
    responsibleEntity: "ЧЕЗ",
    addresses: [
      {
        originalText: "ул. Кричим",
        formattedAddress: "ул. Кричим, Лозенец, София",
        coordinates: { lat: 42.68, lng: 23.315 },
        geoJson: pointGeometry(23.315, 42.68),
      },
      {
        originalText: "ул. Гоце Делчев",
        formattedAddress: "бул. Гоце Делчев, София",
        coordinates: { lat: 42.678, lng: 23.314 },
        geoJson: pointGeometry(23.314, 42.678),
      },
    ],
    pins: [
      {
        address: "ул. Кричим",
        timespans: [
          {
            start: "12.02.2026 08:00",
            end: "12.02.2026 14:00",
          },
        ],
      },
    ],
    geoJson: featureCollection([pointFeature(23.315, 42.68)]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-road-block-oborishte-1",
    text: "Затворена за движение ул. Оборище заради асфалтиране",
    plainText: "Затворена за движение ул. Оборище заради асфалтиране",
    markdownText:
      "# Затворена улица\n\n**Улица:** ул. Оборище\n\n**Причина:** Асфалтиране\n\n**Период:** 10.02.2026 22:00 - 11.02.2026 06:00",
    categories: ["road-block", "construction-and-repairs"],
    ...messageTimes("2026-02-09T09:00:00Z", "2026-02-09T09:10:00Z", {
      start: "2026-02-10T22:00:00Z",
      end: "2026-02-11T06:00:00Z",
    }),
    source: "rayon-oborishte-bg",
    responsibleEntity: "Район Оборище",
    addresses: [
      {
        originalText: "ул. Оборище",
        formattedAddress: "ул. Оборище, София",
        coordinates: { lat: 42.696, lng: 23.3375 },
        geoJson: pointGeometry(23.3375, 42.696),
      },
    ],
    streets: [
      {
        street: "ул. Оборище",
        from: "бул. Васил Левски",
        to: "ул. Граф Игнатиев",
        timespans: [
          {
            start: "10.02.2026 22:00",
            end: "11.02.2026 06:00",
          },
        ],
      },
    ],
    geoJson: featureCollection([
      lineFeature([
        [23.335, 42.695],
        [23.34, 42.698],
      ]),
    ]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-parking-studentski-1",
    text: "Създаване на нови паркоместа в ж.к. Студентски град",
    aiProcessed: true,
    plainText: "Създаване на нови паркоместа в ж.к. Студентски град",
    categories: ["parking"],
    ...messageTimes("2026-02-06T15:00:00Z", "2026-02-06T15:20:00Z", {
      start: "2026-02-08T00:00:00Z",
      end: "2026-02-28T23:59:59Z",
    }),
    source: "studentski-bg",
    responsibleEntity: "Район Студентски",
    geoJson: featureCollection([pointFeature(23.35, 42.655)]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-weather-citywide-1",
    text: "Жълт код за силен вятър в София. Очакват се пориви до 25 м/с.",
    aiProcessed: true,
    plainText: "Жълт код за силен вятър в София. Очакват се пориви до 25 м/с.",
    categories: ["weather"],
    ...messageTimes("2026-02-09T18:00:00Z", "2026-02-09T18:05:00Z", {
      start: "2026-02-10T00:00:00Z",
      end: "2026-02-10T23:59:59Z",
    }),
    source: "nimh-severe-weather",
    sourceUrl: "https://www.nimh.bg",
    responsibleEntity: "НИМХ",
    cityWide: true,
    geoJson: featureCollection([]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-event-vazrazhdane-1",
    text: "Концерт на открито в парк Възраждане на 15 февруари",
    plainText: "Концерт на открито в парк Възраждане на 15 февруари",
    categories: ["culture"],
    ...messageTimes("2026-02-05T10:00:00Z", "2026-02-05T10:15:00Z", {
      start: "2026-02-15T18:00:00Z",
      end: "2026-02-15T21:00:00Z",
    }),
    source: "so-slatina-org",
    responsibleEntity: "Район Слатина",
    geoJson: featureCollection([pointFeature(23.29, 42.71)]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-bicycles-sredec-1",
    text: "Нова велоалея по ул. Цар Освободител от НДК до Орлов мост",
    aiProcessed: true,
    plainText: "Нова велоалея по ул. Цар Освободител от НДК до Орлов мост",
    categories: ["bicycles", "construction-and-repairs"],
    ...messageTimes("2026-02-04T14:00:00Z", "2026-02-04T14:20:00Z", {
      start: "2026-02-04T00:00:00Z",
      end: "2026-03-15T23:59:59Z",
    }),
    source: "sredec-sofia-org",
    responsibleEntity: "Район Средец",
    geoJson: featureCollection([
      lineFeature([
        [23.319, 42.685],
        [23.332, 42.693],
      ]),
    ]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-health-lozenets-2",
    text: "Безплатни прегледи за хипертония в ДКЦ Лозенец",
    aiProcessed: true,
    plainText: "Безплатни прегледи за хипертония в ДКЦ Лозенец",
    categories: ["health"],
    ...messageTimes("2026-02-03T11:00:00Z", "2026-02-03T11:10:00Z", {
      start: "2026-02-14T09:00:00Z",
      end: "2026-02-14T17:00:00Z",
    }),
    source: "lozenets-sofia-bg",
    responsibleEntity: "Район Лозенец",
    geoJson: featureCollection([pointFeature(23.328, 42.682)]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-sports-mladost-3",
    text: "Турнир по футбол за деца в Спортен комплекс Младост",
    aiProcessed: true,
    plainText: "Турнир по футбол за деца в Спортен комплекс Младост",
    categories: ["sports"],
    ...messageTimes("2026-02-02T13:00:00Z", "2026-02-02T13:15:00Z", {
      start: "2026-02-16T10:00:00Z",
      end: "2026-02-16T16:00:00Z",
    }),
    source: "mladost-bg",
    responsibleEntity: "Район Младост",
    geoJson: featureCollection([pointFeature(23.376, 42.645)]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-art-center-4",
    text: "Изложба на съвременно изкуство в Градската градина",
    aiProcessed: true,
    plainText: "Изложба на съвременно изкуство в Градската градина",
    categories: ["art"],
    ...messageTimes("2026-02-01T16:00:00Z", "2026-02-01T16:10:00Z", {
      start: "2026-02-10T10:00:00Z",
      end: "2026-02-20T18:00:00Z",
    }),
    source: "sofia-bg",
    responsibleEntity: "Столична община",
    geoJson: featureCollection([pointFeature(23.331, 42.696)]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-traffic-ring-road-1",
    text: "Интензивен трафик на Околовръстен път заради катастрофа",
    aiProcessed: true,
    plainText: "Интензивен трафик на Околовръстен път заради катастрофа",
    categories: ["traffic", "vehicles"],
    ...messageTimes("2026-02-10T07:30:00Z", "2026-02-10T07:35:00Z", {
      start: "2026-02-10T07:00:00Z",
      end: "2026-02-10T10:00:00Z",
    }),
    source: "sofia-bg",
    responsibleEntity: "ОД на МВР",
    geoJson: featureCollection([pointFeature(23.42, 42.67)]),
  },
  {
    locality: SOFIA_LOCALITY,
    id: "msg-air-quality-center-5",
    text: "Повишени нива на фини прахови частици в центъра на София",
    aiProcessed: true,
    plainText: "Повишени нива на фини прахови частици в центъра на София",
    categories: ["air-quality"],
    ...messageTimes("2026-02-09T20:00:00Z", "2026-02-09T20:05:00Z", {
      start: "2026-02-10T00:00:00Z",
      end: "2026-02-11T23:59:59Z",
    }),
    source: "sofia-bg",
    responsibleEntity: "РИОСВ София",
    geoJson: featureCollection([pointFeature(23.3219, 42.6977)]),
  },

  // Messages with no GeoJSON (edge case)
  {
    locality: SOFIA_LOCALITY,
    id: "msg-no-geojson-1",
    text: "Обявление за обществена поръчка за озеленяване",
    aiProcessed: true,
    plainText: "Обявление за обществена поръчка за озеленяване",
    categories: ["construction-and-repairs"],
    ...messageTimes("2026-01-30T10:00:00Z", "2026-01-30T10:15:00Z"),
    source: "sofia-bg",
    responsibleEntity: "Столична община",
  },

  // Messages without categories (edge case)
  {
    locality: SOFIA_LOCALITY,
    id: "msg-uncategorized-1",
    text: "Общо съобщение от кмета на София",
    aiProcessed: true,
    plainText: "Общо съобщение от кмета на София",
    ...messageTimes("2026-02-01T12:00:00Z", "2026-02-01T12:05:00Z"),
    source: "sofia-bg",
    geoJson: featureCollection([pointFeature(23.3219, 42.6977)]),
  },

  // Long text edge case
  {
    locality: SOFIA_LOCALITY,
    id: "msg-long-text-1",
    text: "Във връзка с предстоящия ремонт на улична мрежа в централната градска част, Столичната община уведомява гражданите, че на 15 февруари 2026 г. ще започнат строителни дейности по цялостно обновяване на пътната настилка на бул. Цар Борис III от кръстовището с бул. Джавахарлал Неру до Централна гара. Ремонтът е част от мащабна програма за модернизация на транспортната инфраструктура и ще продължи ориентировъчно до края на март 2026 г.",
    aiProcessed: true,
    plainText:
      "Във връзка с предстоящия ремонт на улична мрежа в централната градска част, Столичната община уведомява гражданите, че на 15 февруари 2026 г. ще започнат строителни дейности по цялостно обновяване на пътната настилка на бул. Цар Борис III от кръстовището с бул. Джавахарлал Неру до Централна гара. Ремонтът е част от мащабна програма за модернизация на транспортната инфраструктура и ще продължи ориентировъчно до края на март 2026 г.",
    categories: ["construction-and-repairs", "traffic"],
    ...messageTimes("2026-02-08T11:00:00Z", "2026-02-08T11:20:00Z", {
      start: "2026-02-15T00:00:00Z",
      end: "2026-03-31T23:59:59Z",
    }),
    source: "sofia-bg",
    responsibleEntity: "Столична община",
    geoJson: featureCollection([
      lineFeature([
        [23.308, 42.695],
        [23.318, 42.698],
      ]),
    ]),
  },

  // Bus stop edge case
  {
    locality: SOFIA_LOCALITY,
    id: "msg-bus-stop-1",
    text: "Временна промяна на спирка на автобус №94 - спира до блок 23 в ж.к. Дружба",
    aiProcessed: true,
    plainText:
      "Временна промяна на спирка на автобус №94 - спира до блок 23 в ж.к. Дружба",
    categories: ["public-transport"],
    ...messageTimes("2026-02-09T15:00:00Z", "2026-02-09T15:10:00Z", {
      start: "2026-02-11T05:00:00Z",
      end: "2026-02-18T22:00:00Z",
    }),
    source: "sofia-bg",
    responsibleEntity: "ЦГМ",
    busStops: ["Автобус 94 - ж.к. Дружба, блок 23"],
    geoJson: featureCollection([pointFeature(23.4, 42.66)]),
  },
];
