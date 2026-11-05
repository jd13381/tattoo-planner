# Arm vermessen und fotografieren

> Hinweis: Der Planner hat jetzt einen geführten Assistenten (Einstellungen → Body & measurements → „Measure yourself“), der diese Messungen Schritt für Schritt abfragt und direkt speichert.

<!-- Exception to the English-docs rule: Jan asked for this guide in German (2026-11-03). -->

Anleitung für die Zahlen in `config/measurements.yaml` (PROJECT_BRIEF.md §13.1) und die Fotos für `arm-photos/` und `existing/` im Datenordner. Aus den Zahlen baut der Planner den 3D-Arm; die Fotos dienen zum Abgleich der Form und zum Platzieren des Anubis.

Die Messwerte trägst du ganz unten unter [Eintragen](#eintragen) ein, dort steht auch die [Foto-Checkliste](#foto-checkliste). Claude überträgt die Werte dann in `config/measurements.yaml`.

**Du brauchst:** ein weiches Maßband (Schneidermaßband), einen hautfreundlichen Stift oder kleine Aufkleber, eine zweite Person (die meisten Maße gehen nicht einhändig), eine Handykamera und eine ruhige, einfarbige Wand.

## Messpunkte

Markiere zuerst diese Punkte am linken Arm. Alle Längen und Positionen unten gehen von einem davon aus.

| Messpunkt        | Wo                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Schulterspitze   | Der knöcherne Punkt außen oben an der Schulter (Akromion). Das Schlüsselbein nach außen bis zu seinem Ende ertasten. |
| Ellbogenspitze   | Der knöcherne Punkt hinten am Ellbogen (Olekranon), Arm gestreckt.                                                   |
| Handgelenksfalte | Die Hautfalte zwischen Hand und Unterarm, auf der Handflächenseite.                                                  |

## Haltung

Aufrecht stehen, linker Arm hängt locker und gestreckt, leicht vom Körper weg, Handfläche zeigt nach vorne. Bei jeder Messung Muskeln entspannt lassen (nicht anspannen).

## Längen

Außen am Arm entlang messen, das Band liegt auf der Haut und wird nicht straff gezogen.

| Feld                | Von → bis                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `shoulder_to_elbow` | Schulterspitze → Ellbogenspitze                                                           |
| `elbow_to_wrist`    | Ellbogenspitze → Handgelenksfalte (über die Außenkante des Unterarms bis zur Faltenlinie) |

## Umfänge

Band waagrecht (im rechten Winkel zum Arm), eng auf der Haut, ohne einzudrücken. Den Wert dort ablesen, wo sich das Band überlappt. Jeden Umfang zweimal messen; weichen die beiden Werte um mehr als 0,5 cm ab, ein drittes Mal messen und den mittleren Wert nehmen.

| Feld           | Wo                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wrist`        | an der Handgelenksfalte                                                                                                                            |
| `forearm_mid`  | in der Mitte zwischen Handgelenksfalte und Ellbogenspitze                                                                                          |
| `forearm_max`  | an der dicksten Stelle des Unterarms, ein paar cm unter dem Ellbogen; dazu `forearm_max_below_elbow` notieren (Ellbogenspitze runter bis zum Band) |
| `elbow`        | über der Ellbogenspitze                                                                                                                            |
| `above_elbow`  | 5 cm über der Ellbogenspitze                                                                                                                       |
| `biceps_mid`   | in der Mitte zwischen Ellbogenspitze und Schulterspitze, entspannt                                                                                 |
| `armpit_level` | auf Höhe der Achselfalte; dazu `armpit_level_below_shoulder` notieren (Schulterspitze runter bis zum Band, außen am Arm gemessen)                  |
| `shoulder`     | so hoch um den Deltamuskel, wie das Band gerade noch waagrecht sitzt; dazu `shoulder_below_shoulder` notieren (Schulterspitze runter bis zum Band) |

## Anubis

Das Band längs auf den Unterarm legen, Handfläche nach oben.

| Feld                  | Was                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------- |
| `distance_from_wrist` | Handgelenksfalte → tiefster Punkt des Tattoos (Stoffbänder mitgerechnet)            |
| `height`              | tiefster → höchster Punkt des Tattoos, entlang des Arms                             |
| `width`               | breiteste Stelle quer zum Arm, über die Haut gemessen (nicht gerade durch die Luft) |

## Fotos

Im Datenordner speichern, nie im Repo:

- `arm-photos/front.jpg`, `back.jpg`, `lateral.jpg`, `medial.jpg`
- `existing/anubis-front.jpg`

**Für alle Fotos:** einfarbige Wand, gleichmäßiges Licht ohne harte Schatten, ärmelloses Shirt. Die zweite Person steht etwa 2 m entfernt und zoomt heran (bei den meisten Handys 2×), statt näher zu kommen: So bleibt die Perspektive flach. Kamera auf Ellbogenhöhe, gerade gehalten (nicht gekippt). Ein Maßband längs an den Arm legen oder daneben kleben, damit der Maßstab im Bild lesbar ist. Der ganze Arm von der Schulter bis zum Handgelenk muss drauf sein.

| Foto           | Haltung                                                                               | Kamera                                                      |
| -------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `front`        | Gesicht zur Kamera, Arm hängt leicht vom Körper weg, Handfläche nach vorne            | vorne                                                       |
| `back`         | Rücken zur Kamera, gleiche Armhaltung                                                 | hinten                                                      |
| `lateral`      | linke Seite zur Kamera, Arm hängt, Handfläche zum Oberschenkel                        | links                                                       |
| `medial`       | Arm waagrecht nach vorne gestreckt, Handfläche nach oben                              | rechts neben dem Arm, auf Armhöhe, Blick auf die Innenseite |
| `anubis-front` | Unterarm liegt mit der Handfläche nach oben auf einem Tisch, Maßband neben dem Tattoo | senkrecht über dem Tattoo, Linse parallel zur Haut          |

Weitere Fotos (gebeugter Ellbogen, Nahaufnahmen) dürfen beliebig heißen.

## Eintragen

Werte in cm in die Spalte „Wert“ schreiben, Dezimalstellen mit Punkt oder Komma. Bei Umfängen den Endwert eintragen (Mittelwert bzw. mittlerer von drei). Leere Felder bleiben im Planner Platzhalter.

Gemessen am: \_\_\_\_\_\_\_\_\_\_

### Längen

| Feld                | Beschreibung                    | Wert (cm) |
| ------------------- | ------------------------------- | --------- |
| `shoulder_to_elbow` | Schulterspitze → Ellbogenspitze | 44        |
| `elbow_to_wrist`    | Ellbogenspitze → Handgelenk     | 30        |

### Umfänge

| Feld           | Beschreibung                               | 1. Messung | 2. Messung | Wert (cm) |
| -------------- | ------------------------------------------ | ---------- | ---------- | --------- |
| `wrist`        | Handgelenksfalte                           |            |            | 19        |
| `forearm_mid`  | Mitte Unterarm                             |            |            | 25        |
| `forearm_max`  | dickste Stelle Unterarm                    |            |            | 29        |
| `elbow`        | über der Ellbogenspitze                    |            |            | 29        |
| `above_elbow`  | 5 cm über der Ellbogenspitze               |            |            | 33        |
| `biceps_mid`   | Mitte Oberarm, entspannt                   |            |            | 36        |
| `armpit_level` | Höhe Achselfalte                           |            |            | 38        |
| `shoulder`     | Deltamuskel, so hoch wie waagrecht möglich | 50         |            | 40        |

### Positionen

| Feld                          | Beschreibung                             | Wert (cm) |
| ----------------------------- | ---------------------------------------- | --------- |
| `forearm_max_below_elbow`     | Ellbogenspitze → Band bei `forearm_max`  | 10        |
| `armpit_level_below_shoulder` | Schulterspitze → Band bei `armpit_level` | 17        |
| `shoulder_below_shoulder`     | Schulterspitze → Band bei `shoulder`     | 10        |

### Anubis

| Feld                  | Beschreibung                         | Wert (cm) |
| --------------------- | ------------------------------------ | --------- |
| `distance_from_wrist` | Handgelenksfalte → tiefster Punkt    | 2         |
| `height`              | Höhe entlang des Arms                | 26        |
| `width`               | breiteste Stelle quer, über die Haut | 12        |

### Foto-Checkliste

Abhaken, was im Datenordner liegt. Wie die Fotos aufgenommen werden, steht oben unter [Fotos](#fotos).

- [x] `arm-photos/front.jpg`: Gesicht zur Kamera, Arm hängt, Handfläche nach vorne (Innenseite)
- [x] `arm-photos/back.jpg`: Rücken zur Kamera, gleiche Haltung (Außenseite)
- [x] `arm-photos/lateral.jpg`: linke Seite zur Kamera, Handfläche zum Oberschenkel (Daumenseite)
- [x] `arm-photos/medial.jpg`: Arm waagrecht nach vorne, Handfläche nach oben, Kamera rechts daneben (Körperseite)
- [x] `existing/anubis-front.jpg`: Unterarm auf dem Tisch, Kamera senkrecht über dem Anubis
- [x] Auf jedem Foto ist ein Maßband zu sehen

### Notizen

<!-- Alles, was beim Messen auffällt (z. B. Ellbogen nicht ganz gestreckt, Band verrutscht). -->

- `shoulder`: gemessen 50 cm, vermutlich um den Oberkörper statt nur um den Arm. Ersetzt durch den Schätzwert 40 cm (etwas mehr als `armpit_level`), bis neu gemessen wird.
