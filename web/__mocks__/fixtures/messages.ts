import type { Message } from "@oboapp/shared";

/**
 * Static fixtures for messages
 * ~20 messages covering all categories, mixed locations (clustered + scattered)
 */
export const MOCK_MESSAGES: Message[] = [
  // Cluster 1: City center (around 42.6977, 23.3219)
  {
    locality: "bg.sofia",
    id: "msg-water-center-1",
    text: "Планирано спиране на водоподаването на ул. Граф Игнатиев от No 5 до No 25",
    plainText:
      "Планирано спиране на водоподаването на ул. Граф Игнатиев от No 5 до No 25",
    markdownText:
      "**Планирано спиране** на водоподаването на **ул. Граф Игнатиев** от No 5 до No 25",
    categories: ["water"],
    createdAt: new Date("2026-02-09T08:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-09T08:05:00Z").toISOString(),
    timespanStart: new Date("2026-02-10T09:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-10T17:00:00Z").toISOString(),
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
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [23.3205, 42.6965],
              [23.3225, 42.6975],
            ],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-construction-center-2",
    text: "Ремонт на тротоара на бул. Витоша между ул. Московска и ул. Алабин",
    plainText:
      "Ремонт на тротоара на бул. Витоша между ул. Московска и ул. Алабин",
    markdownText:
      "# Ремонт на тротоар\n\n**Локация:** бул. Витоша между ул. Московска и ул. Алабин\n\n**Период:** 08.02.2026 - 20.02.2026",
    categories: ["construction-and-repairs"],
    createdAt: new Date("2026-02-08T10:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-08T10:10:00Z").toISOString(),
    timespanStart: new Date("2026-02-08T00:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-20T23:59:59Z").toISOString(),
    source: "sofia-bg",
    sourceUrl: "https://www.sofia.bg",
    responsibleEntity: "Столична община",
    addresses: [
      {
        originalText: "бул. Витоша",
        formattedAddress: "бул. Витоша, София",
        coordinates: { lat: 42.6975, lng: 23.3205 },
        geoJson: {
          type: "Point",
          coordinates: [23.3205, 42.6975],
        },
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
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [23.3195, 42.6955],
              [23.3215, 42.6985],
            ],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-public-transport-center-3",
    text: "Промяна в движението на трамваи №10 и №12 поради ремонт на релсите на бул. Христо Ботев",
    plainText:
      "Промяна в движението на трамваи №10 и №12 поради ремонт на релсите на бул. Христо Ботев",
    categories: ["public-transport", "traffic"],
    createdAt: new Date("2026-02-09T14:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-09T14:15:00Z").toISOString(),
    timespanStart: new Date("2026-02-10T06:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-15T22:00:00Z").toISOString(),
    source: "sofia-bg",
    responsibleEntity: "ЦГМ",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [23.315, 42.7],
              [23.32, 42.705],
            ],
          },
          properties: {},
        },
      ],
    },
  },

  // Cluster 2: Mladost district (east, around 42.65, 23.38)
  {
    locality: "bg.sofia",
    id: "msg-heating-mladost-1",
    text: "Авария на топлопровод в ж.к. Младост 1, блокове 40-50",
    plainText: "Авария на топлопровод в ж.к. Младост 1, блокове 40-50",
    categories: ["heating"],
    createdAt: new Date("2026-02-09T06:30:00Z").toISOString(),
    finalizedAt: new Date("2026-02-09T06:45:00Z").toISOString(),
    timespanStart: new Date("2026-02-09T06:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-10T12:00:00Z").toISOString(),
    source: "toplo-bg",
    sourceUrl: "https://www.toplo.bg",
    responsibleEntity: "Топлофикация София",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [23.38, 42.65],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-waste-mladost-2",
    text: "Почистване на контейнери за смет в района на бул. Александър Малинов",
    plainText:
      "Почистване на контейнери за смет в района на бул. Александър Малинов",
    categories: ["waste"],
    createdAt: new Date("2026-02-08T16:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-08T16:10:00Z").toISOString(),
    timespanStart: new Date("2026-02-11T07:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-11T15:00:00Z").toISOString(),
    source: "mladost-bg",
    responsibleEntity: "Район Младост",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [23.375, 42.648],
              [23.385, 42.652],
            ],
          },
          properties: {},
        },
      ],
    },
  },

  // Scattered messages across Sofia
  {
    locality: "bg.sofia",
    id: "msg-electricity-lozenets-1",
    text: "Планирано прекъсване на електрозахранването в района на ул. Кричим и ул. Гоце Делчев",
    plainText:
      "Планирано прекъсване на електрозахранването в района на ул. Кричим и ул. Гоце Делчев",
    markdownText:
      "# Прекъсване на ток\n\n**Локация:** ул. Кричим и ул. Гоце Делчев\n\n**Дата:** 12.02.2026\n\n**Време:** 08:00 - 14:00",
    categories: ["electricity"],
    createdAt: new Date("2026-02-07T12:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-07T12:15:00Z").toISOString(),
    timespanStart: new Date("2026-02-12T08:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-12T14:00:00Z").toISOString(),
    source: "erm-zapad",
    sourceUrl: "https://www.cez.bg",
    responsibleEntity: "ЧЕЗ",
    addresses: [
      {
        originalText: "ул. Кричим",
        formattedAddress: "ул. Кричим, Лозенец, София",
        coordinates: { lat: 42.68, lng: 23.315 },
        geoJson: {
          type: "Point",
          coordinates: [23.315, 42.68],
        },
      },
      {
        originalText: "ул. Гоце Делчев",
        formattedAddress: "бул. Гоце Делчев, София",
        coordinates: { lat: 42.678, lng: 23.314 },
        geoJson: {
          type: "Point",
          coordinates: [23.314, 42.678],
        },
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
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [23.315, 42.68],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-road-block-oborishte-1",
    text: "Затворена за движение ул. Оборище заради асфалтиране",
    plainText: "Затворена за движение ул. Оборище заради асфалтиране",
    markdownText:
      "# Затворена улица\n\n**Улица:** ул. Оборище\n\n**Причина:** Асфалтиране\n\n**Период:** 10.02.2026 22:00 - 11.02.2026 06:00",
    categories: ["road-block", "construction-and-repairs"],
    createdAt: new Date("2026-02-09T09:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-09T09:10:00Z").toISOString(),
    timespanStart: new Date("2026-02-10T22:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-11T06:00:00Z").toISOString(),
    source: "rayon-oborishte-bg",
    responsibleEntity: "Район Оборище",
    addresses: [
      {
        originalText: "ул. Оборище",
        formattedAddress: "ул. Оборище, София",
        coordinates: { lat: 42.696, lng: 23.3375 },
        geoJson: {
          type: "Point",
          coordinates: [23.3375, 42.696],
        },
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
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [23.335, 42.695],
              [23.34, 42.698],
            ],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-parking-studentski-1",
    text: "Създаване на нови паркоместа в ж.к. Студентски град",
    aiProcessed: true,
    plainText: "Създаване на нови паркоместа в ж.к. Студентски град",
    categories: ["parking"],
    createdAt: new Date("2026-02-06T15:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-06T15:20:00Z").toISOString(),
    timespanStart: new Date("2026-02-08T00:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-28T23:59:59Z").toISOString(),
    source: "studentski-bg",
    responsibleEntity: "Район Студентски",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [23.35, 42.655],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-weather-citywide-1",
    text: "Жълт код за силен вятър в София. Очакват се пориви до 25 м/с.",
    aiProcessed: true,
    plainText: "Жълт код за силен вятър в София. Очакват се пориви до 25 м/с.",
    categories: ["weather"],
    createdAt: new Date("2026-02-09T18:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-09T18:05:00Z").toISOString(),
    timespanStart: new Date("2026-02-10T00:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-10T23:59:59Z").toISOString(),
    source: "nimh-severe-weather",
    sourceUrl: "https://www.nimh.bg",
    responsibleEntity: "НИМХ",
    cityWide: true,
    geoJson: {
      type: "FeatureCollection",
      features: [],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-event-vazrazhdane-1",
    text: "Концерт на открито в парк Възраждане на 15 февруари",
    plainText: "Концерт на открито в парк Възраждане на 15 февруари",
    categories: ["culture"],
    createdAt: new Date("2026-02-05T10:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-05T10:15:00Z").toISOString(),
    timespanStart: new Date("2026-02-15T18:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-15T21:00:00Z").toISOString(),
    source: "so-slatina-org",
    responsibleEntity: "Район Слатина",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [23.29, 42.71],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-bicycles-sredec-1",
    text: "Нова велоалея по ул. Цар Освободител от НДК до Орлов мост",
    aiProcessed: true,
    plainText: "Нова велоалея по ул. Цар Освободител от НДК до Орлов мост",
    categories: ["bicycles", "construction-and-repairs"],
    createdAt: new Date("2026-02-04T14:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-04T14:20:00Z").toISOString(),
    timespanStart: new Date("2026-02-04T00:00:00Z").toISOString(),
    timespanEnd: new Date("2026-03-15T23:59:59Z").toISOString(),
    source: "sredec-sofia-org",
    responsibleEntity: "Район Средец",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [23.319, 42.685],
              [23.332, 42.693],
            ],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-health-lozenets-2",
    text: "Безплатни прегледи за хипертония в ДКЦ Лозенец",
    aiProcessed: true,
    plainText: "Безплатни прегледи за хипертония в ДКЦ Лозенец",
    categories: ["health"],
    createdAt: new Date("2026-02-03T11:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-03T11:10:00Z").toISOString(),
    timespanStart: new Date("2026-02-14T09:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-14T17:00:00Z").toISOString(),
    source: "lozenets-sofia-bg",
    responsibleEntity: "Район Лозенец",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [23.328, 42.682],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-sports-mladost-3",
    text: "Турнир по футбол за деца в Спортен комплекс Младост",
    aiProcessed: true,
    plainText: "Турнир по футбол за деца в Спортен комплекс Младост",
    categories: ["sports"],
    createdAt: new Date("2026-02-02T13:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-02T13:15:00Z").toISOString(),
    timespanStart: new Date("2026-02-16T10:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-16T16:00:00Z").toISOString(),
    source: "mladost-bg",
    responsibleEntity: "Район Младост",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [23.376, 42.645],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-art-center-4",
    text: "Изложба на съвременно изкуство в Градската градина",
    aiProcessed: true,
    plainText: "Изложба на съвременно изкуство в Градската градина",
    categories: ["art"],
    createdAt: new Date("2026-02-01T16:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-01T16:10:00Z").toISOString(),
    timespanStart: new Date("2026-02-10T10:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-20T18:00:00Z").toISOString(),
    source: "sofia-bg",
    responsibleEntity: "Столична община",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [23.331, 42.696],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-traffic-ring-road-1",
    text: "Интензивен трафик на Околовръстен път заради катастрофа",
    aiProcessed: true,
    plainText: "Интензивен трафик на Околовръстен път заради катастрофа",
    categories: ["traffic", "vehicles"],
    createdAt: new Date("2026-02-10T07:30:00Z").toISOString(),
    finalizedAt: new Date("2026-02-10T07:35:00Z").toISOString(),
    timespanStart: new Date("2026-02-10T07:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-10T10:00:00Z").toISOString(),
    source: "sofia-bg",
    responsibleEntity: "ОД на МВР",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [23.42, 42.67],
          },
          properties: {},
        },
      ],
    },
  },
  {
    locality: "bg.sofia",
    id: "msg-air-quality-center-5",
    text: "Повишени нива на фини прахови частици в центъра на София",
    aiProcessed: true,
    plainText: "Повишени нива на фини прахови частици в центъра на София",
    categories: ["air-quality"],
    createdAt: new Date("2026-02-09T20:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-09T20:05:00Z").toISOString(),
    timespanStart: new Date("2026-02-10T00:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-11T23:59:59Z").toISOString(),
    source: "sofia-bg",
    responsibleEntity: "РИОСВ София",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [23.3219, 42.6977],
          },
          properties: {},
        },
      ],
    },
  },

  // Messages with no GeoJSON (edge case)
  {
    locality: "bg.sofia",
    id: "msg-no-geojson-1",
    text: "Обявление за обществена поръчка за озеленяване",
    aiProcessed: true,
    plainText: "Обявление за обществена поръчка за озеленяване",
    categories: ["construction-and-repairs"],
    createdAt: new Date("2026-01-30T10:00:00Z").toISOString(),
    finalizedAt: new Date("2026-01-30T10:15:00Z").toISOString(),
    source: "sofia-bg",
    responsibleEntity: "Столична община",
  },

  // Messages without categories (edge case)
  {
    locality: "bg.sofia",
    id: "msg-uncategorized-1",
    text: "Общо съобщение от кмета на София",
    aiProcessed: true,
    plainText: "Общо съобщение от кмета на София",
    createdAt: new Date("2026-02-01T12:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-01T12:05:00Z").toISOString(),
    source: "sofia-bg",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [23.3219, 42.6977],
          },
          properties: {},
        },
      ],
    },
  },

  // Long text edge case
  {
    locality: "bg.sofia",
    id: "msg-long-text-1",
    text: "Във връзка с предстоящия ремонт на улична мрежа в централната градска част, Столичната община уведомява гражданите, че на 15 февруари 2026 г. ще започнат строителни дейности по цялостно обновяване на пътната настилка на бул. Цар Борис III от кръстовището с бул. Джавахарлал Неру до Централна гара. Ремонтът е част от мащабна програма за модернизация на транспортната инфраструктура и ще продължи ориентировъчно до края на март 2026 г.",
    aiProcessed: true,
    plainText:
      "Във връзка с предстоящия ремонт на улична мрежа в централната градска част, Столичната община уведомява гражданите, че на 15 февруари 2026 г. ще започнат строителни дейности по цялостно обновяване на пътната настилка на бул. Цар Борис III от кръстовището с бул. Джавахарлал Неру до Централна гара. Ремонтът е част от мащабна програма за модернизация на транспортната инфраструктура и ще продължи ориентировъчно до края на март 2026 г.",
    categories: ["construction-and-repairs", "traffic"],
    createdAt: new Date("2026-02-08T11:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-08T11:20:00Z").toISOString(),
    timespanStart: new Date("2026-02-15T00:00:00Z").toISOString(),
    timespanEnd: new Date("2026-03-31T23:59:59Z").toISOString(),
    source: "sofia-bg",
    responsibleEntity: "Столична община",
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [23.308, 42.695],
              [23.318, 42.698],
            ],
          },
          properties: {},
        },
      ],
    },
  },

  // Bus stop edge case
  {
    locality: "bg.sofia",
    id: "msg-bus-stop-1",
    text: "Временна промяна на спирка на автобус №94 - спира до блок 23 в ж.к. Дружба",
    aiProcessed: true,
    plainText:
      "Временна промяна на спирка на автобус №94 - спира до блок 23 в ж.к. Дружба",
    categories: ["public-transport"],
    createdAt: new Date("2026-02-09T15:00:00Z").toISOString(),
    finalizedAt: new Date("2026-02-09T15:10:00Z").toISOString(),
    timespanStart: new Date("2026-02-11T05:00:00Z").toISOString(),
    timespanEnd: new Date("2026-02-18T22:00:00Z").toISOString(),
    source: "sofia-bg",
    responsibleEntity: "ЦГМ",
    busStops: ["Автобус 94 - ж.к. Дружба, блок 23"],
    geoJson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [23.4, 42.66],
          },
          properties: {},
        },
      ],
    },
  },
];
