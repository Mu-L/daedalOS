import { basename, dirname, extname, join } from "path";
import { type URLTrack } from "webamp";
import { useMemo } from "react";
import { type FileStat } from "components/system/Files/FileManager/functions";
import { EXTRACTABLE_EXTENSIONS } from "components/system/Files/FileEntry/constants";
import extensions from "components/system/Files/FileEntry/extensions";
import {
  getProcessByFileExtension,
  isExistingFile,
} from "components/system/Files/FileEntry/functions";
import useFile from "components/system/Files/FileEntry/useFile";
import { type FocusEntryFunctions } from "components/system/Files/FileManager/useFocusableEntries";
import { type FileActions } from "components/system/Files/FileManager/useFolder";
import { useFileSystem } from "contexts/fileSystem";
import { useMenu } from "contexts/menu";
import {
  type ContextMenuCapture,
  type MenuItem,
} from "contexts/menu/useMenuContextState";
import { useProcesses } from "contexts/process";
import processDirectory from "contexts/process/directory";
import { useSession } from "contexts/session";
import { useProcessesRef } from "hooks/useProcessesRef";
import {
  AI_TITLE,
  AUDIO_PLAYLIST_EXTENSIONS,
  CURSOR_FILE_EXTENSIONS,
  DESKTOP_PATH,
  EDITABLE_IMAGE_FILE_EXTENSIONS,
  IMAGE_FILE_EXTENSIONS,
  MENU_SEPERATOR,
  MOUNTABLE_EXTENSIONS,
  PACKAGE_DATA,
  PROCESS_DELIMITER,
  ROOT_SHORTCUT,
  SHORTCUT_EXTENSION,
  SPREADSHEET_FORMATS,
  SUMMARIZABLE_FILE_EXTENSIONS,
  TEXT_EDITORS,
  VIDEO_FILE_EXTENSIONS,
} from "utils/constants";
import {
  AUDIO_DECODE_FORMATS,
  AUDIO_ENCODE_FORMATS,
  VIDEO_DECODE_FORMATS,
  VIDEO_ENCODE_FORMATS,
} from "utils/ffmpeg/formats";
import {
  getExtension,
  isSafari,
  isYouTubeUrl,
  saveUnpositionedDesktopIcons,
} from "utils/functions";
import {
  IMAGE_DECODE_FORMATS,
  IMAGE_ENCODE_FORMATS,
} from "utils/imagemagick/formats";
import { Share } from "components/system/Menu/MenuIcons";
import { useWindowAI } from "hooks/useWindowAI";
import { getNavButtonByTitle } from "hooks/useGlobalKeyboardShortcuts";
import useTransferDialog, {
  type ObjectReader,
} from "components/system/Dialogs/Transfer/useTransferDialog";
import { isMountedFolder } from "contexts/fileSystem/core";

const { alias } = PACKAGE_DATA;

const useFileContextMenu = (
  url: string,
  pid: string,
  path: string,
  setRenaming: React.Dispatch<React.SetStateAction<string>>,
  {
    archiveFiles,
    deleteLocalPath,
    downloadFiles,
    extractFiles,
    newShortcut,
  }: FileActions,
  { blurEntry, focusEntry }: FocusEntryFunctions,
  focusedEntries: string[],
  stats: FileStat,
  fileManagerId?: string,
  readOnly?: boolean
): ContextMenuCapture => {
  const { close, minimize, open, url: changeUrl } = useProcesses();
  const processesRef = useProcessesRef();
  const {
    aiEnabled,
    setCursor,
    setForegroundId,
    setIconPositions,
    setWallpaper,
    updateRecentFiles,
  } = useSession();
  const baseName = basename(path);
  const isFocusedEntry = useMemo(
    () => focusedEntries.includes(baseName),
    [baseName, focusedEntries]
  );
  const openFile = useFile(url, path);
  const {
    copyEntries,
    createPath,
    lstat,
    mapFs,
    moveEntries,
    readFile,
    rootFs,
    unMapFs,
    updateFolder,
  } = useFileSystem();
  const { contextMenu } = useMenu();
  const hasWindowAI = useWindowAI();
  const { openTransferDialog } = useTransferDialog();
  const { onContextMenuCapture, ...contextMenuHandlers } = useMemo(
    () =>
      contextMenu?.(() => {
        const urlExtension = getExtension(url);
        const { process: extensionProcesses = [] } =
          urlExtension in extensions ? extensions[urlExtension] : {};
        const openWith = extensionProcesses.filter(
          (process) => process !== pid
        );
        const openWithFiltered = openWith.filter((id) => id !== pid);
        const isSingleSelection =
          focusedEntries.length === 1 || !isFocusedEntry;
        const absoluteEntries = (): string[] =>
          isSingleSelection
            ? [path]
            : [
                ...new Set([
                  path,
                  ...focusedEntries.map((entry) => join(dirname(path), entry)),
                ]),
              ];
        const menuItems: MenuItem[] = [];
        const pathExtension = getExtension(path);
        const isShortcut = pathExtension === SHORTCUT_EXTENSION;
        const remoteMount = rootFs?.mountList.some(
          (mountPath) =>
            mountPath === path && isMountedFolder(rootFs?.mntMap[mountPath])
        );

        if (!readOnly && !remoteMount) {
          const defaultProcess = getProcessByFileExtension(urlExtension);

          menuItems.push(
            { action: () => moveEntries(absoluteEntries()), label: "Cut" },
            { action: () => copyEntries(absoluteEntries()), label: "Copy" },
            MENU_SEPERATOR
          );

          if (
            defaultProcess ||
            isShortcut ||
            (!pathExtension && !urlExtension)
          ) {
            menuItems.push({
              action: () =>
                absoluteEntries().forEach(async (entry) => {
                  const shortcutProcess =
                    defaultProcess && !(await lstat(entry)).isDirectory()
                      ? defaultProcess
                      : "FileExplorer";

                  newShortcut(entry, shortcutProcess);
                }),
              label: "Create shortcut",
            });
          }

          menuItems.push(
            {
              action: () => {
                if (dirname(path) === DESKTOP_PATH) {
                  saveUnpositionedDesktopIcons(setIconPositions);
                }

                absoluteEntries().forEach((entry) => deleteLocalPath(entry));
              },
              label: "Delete",
            },
            { action: () => setRenaming(baseName), label: "Rename" },
            MENU_SEPERATOR,
            {
              action: () => {
                const activePid = Object.keys(processesRef.current).find(
                  (p) => p === `Properties${PROCESS_DELIMITER}${url}`
                );

                if (activePid) {
                  if (processesRef.current[activePid].minimized) {
                    minimize(activePid);
                  }

                  setForegroundId(activePid);
                } else {
                  open("Properties", {
                    shortcutPath: isShortcut ? path : undefined,
                    url: isShortcut ? path : url,
                  });
                }
              },
              label: "Properties",
            }
          );

          if (path) {
            if (path === join(DESKTOP_PATH, ROOT_SHORTCUT)) {
              if (typeof FileSystemHandle === "function") {
                const mapFileSystemDirectory = (
                  directory: string,
                  existingHandle?: FileSystemDirectoryHandle
                ): void => {
                  mapFs(directory, existingHandle)
                    .then((mappedFolder) => {
                      updateFolder("/", mappedFolder);
                      open("FileExplorer", {
                        url: join("/", mappedFolder),
                      });
                    })
                    .catch(() => {
                      // Ignore failure to map
                    });
                };
                const showMapDirectory = "showDirectoryPicker" in window;
                const showMapOpfs =
                  typeof navigator.storage?.getDirectory === "function" &&
                  !isSafari();

                menuItems.unshift(
                  ...(showMapDirectory
                    ? [
                        {
                          action: () => mapFileSystemDirectory("/"),
                          label: "Map directory",
                        },
                      ]
                    : []),
                  ...(showMapOpfs
                    ? [
                        {
                          action: async () => {
                            try {
                              mapFileSystemDirectory(
                                "/OPFS",
                                await navigator.storage.getDirectory()
                              );
                            } catch {
                              // Ignore failure to map directory
                            }
                          },
                          label: "Map OPFS",
                        },
                      ]
                    : []),
                  ...(showMapDirectory || showMapOpfs ? [MENU_SEPERATOR] : [])
                );
              }
            } else {
              menuItems.unshift(MENU_SEPERATOR);

              const canDecodeAudio = AUDIO_DECODE_FORMATS.has(pathExtension);
              const canDecodeImage = IMAGE_DECODE_FORMATS.has(pathExtension);
              const canDecodeVideo = VIDEO_DECODE_FORMATS.has(pathExtension);

              if (canDecodeAudio || canDecodeImage || canDecodeVideo) {
                const isAudioVideo = canDecodeAudio || canDecodeVideo;
                const ENCODE_FORMATS = isAudioVideo
                  ? canDecodeAudio
                    ? AUDIO_ENCODE_FORMATS
                    : VIDEO_ENCODE_FORMATS
                  : IMAGE_ENCODE_FORMATS;

                menuItems.unshift(MENU_SEPERATOR, {
                  label: "Convert to",
                  menu: ENCODE_FORMATS.filter(
                    (format) => format !== pathExtension
                  ).map((format) => {
                    const extension = format.replace(".", "");

                    return {
                      action: async () => {
                        openTransferDialog(undefined, path, "Converting");

                        const directory = dirname(path);
                        const closeDialog = (): void =>
                          close(`Transfer${PROCESS_DELIMITER}${path}`);

                        try {
                          const transcodeFunction = isAudioVideo
                            ? (await import("utils/ffmpeg")).transcode
                            : (await import("utils/imagemagick")).convert;
                          const objectReaders =
                            absoluteEntries().map<ObjectReader>(
                              (absoluteEntry) => {
                                let aborted = false;

                                return {
                                  abort: () => {
                                    aborted = true;
                                  },
                                  directory,
                                  name: basename(absoluteEntry),
                                  operation: "Converting",
                                  read: async () => {
                                    if (aborted) return;

                                    try {
                                      const [
                                        [
                                          transcodedFileName,
                                          transcodedFileData,
                                        ],
                                      ] = await transcodeFunction(
                                        [
                                          [
                                            absoluteEntry,
                                            await readFile(absoluteEntry),
                                          ],
                                        ],
                                        extension
                                      );

                                      updateFolder(
                                        directory,
                                        await createPath(
                                          basename(transcodedFileName),
                                          directory,
                                          transcodedFileData
                                        )
                                      );
                                    } catch {
                                      // Ignore failure to transcode
                                    }
                                  },
                                };
                              }
                            );

                          openTransferDialog(objectReaders, path);
                        } catch (error) {
                          closeDialog();

                          if ("message" in (error as Error)) {
                            console.error((error as Error).message);
                          }
                        }
                      },
                      label: extension.toUpperCase(),
                    };
                  }),
                });
              }

              const canDecodeSpreadsheet =
                SPREADSHEET_FORMATS.includes(pathExtension);

              if (canDecodeSpreadsheet) {
                menuItems.unshift(MENU_SEPERATOR, {
                  label: "Convert to",
                  menu: SPREADSHEET_FORMATS.filter(
                    (format) => format !== pathExtension
                  ).map((format) => {
                    const extension = format.replace(".", "");

                    return {
                      action: () => {
                        absoluteEntries().forEach(async (absoluteEntry) => {
                          const newFilePath = `${dirname(
                            absoluteEntry
                          )}/${basename(
                            absoluteEntry,
                            extname(absoluteEntry)
                          )}.${extension}`;
                          const { convertSheet } = await import(
                            "utils/sheetjs"
                          );
                          const workBook = await convertSheet(
                            await readFile(absoluteEntry),
                            extension
                          );
                          const workBookDirName = dirname(path);

                          updateFolder(
                            workBookDirName,
                            await createPath(
                              basename(newFilePath),
                              workBookDirName,
                              Buffer.from(workBook)
                            )
                          );
                        });
                      },
                      label: extension.toUpperCase(),
                    };
                  }),
                });
              }

              const canEncodePlaylist =
                pathExtension !== ".m3u" &&
                AUDIO_PLAYLIST_EXTENSIONS.has(pathExtension);

              if (canEncodePlaylist) {
                menuItems.unshift(MENU_SEPERATOR, {
                  action: () => {
                    absoluteEntries().forEach(async (absoluteEntry) => {
                      const newFilePath = `${dirname(absoluteEntry)}/${basename(
                        absoluteEntry,
                        extname(absoluteEntry)
                      )}.m3u`;
                      const { createM3uPlaylist, tracksFromPlaylist } =
                        await import("components/apps/Webamp/functions");
                      const playlist = createM3uPlaylist(
                        (await tracksFromPlaylist(
                          (await readFile(absoluteEntry)).toString(),
                          getExtension(absoluteEntry)
                        )) as URLTrack[]
                      );
                      const playlistDirName = dirname(path);

                      updateFolder(
                        playlistDirName,
                        await createPath(
                          basename(newFilePath),
                          playlistDirName,
                          Buffer.from(playlist)
                        )
                      );
                    });
                  },
                  label: "Convert to M3U",
                });
              }

              const opensInFileExplorer = pid === "FileExplorer";

              if (
                isSingleSelection &&
                !opensInFileExplorer &&
                !isYouTubeUrl(url)
              ) {
                const baseFileName = basename(url);
                const shareData: ShareData = {
                  text: `${baseFileName} - ${alias}`,
                  title: baseFileName,
                  url: `${window.location.origin}?url=${url}`,
                };

                try {
                  const isFileMounted = rootFs?.mountList.some(
                    (mountPath) =>
                      mountPath !== "/" && path.startsWith(`${mountPath}/`)
                  );

                  if (
                    !isFileMounted &&
                    isExistingFile(stats) &&
                    navigator.canShare?.(shareData)
                  ) {
                    menuItems.unshift({
                      SvgIcon: Share,
                      action: () => navigator.share(shareData),
                      label: "Share",
                    });
                  }
                } catch {
                  // Ignore failure to use Share API
                }
              }

              menuItems.unshift(
                {
                  action: () => archiveFiles(absoluteEntries()),
                  label: "Add to archive...",
                },
                ...(EXTRACTABLE_EXTENSIONS.has(urlExtension) ||
                MOUNTABLE_EXTENSIONS.has(urlExtension)
                  ? [
                      {
                        action: () => extractFiles(url),
                        label: "Extract Here",
                      },
                      MENU_SEPERATOR,
                    ]
                  : []),
                {
                  action: () => downloadFiles(absoluteEntries()),
                  label: "Download",
                }
              );

              if (!isShortcut && !opensInFileExplorer) {
                TEXT_EDITORS.forEach((textEditor) => {
                  if (
                    textEditor !== defaultProcess &&
                    !openWithFiltered.includes(textEditor)
                  ) {
                    openWithFiltered.push(textEditor);
                  }
                });
              }
            }
          }

          menuItems.unshift(MENU_SEPERATOR);
        }

        if (remoteMount) {
          menuItems.push(MENU_SEPERATOR, {
            action: () =>
              unMapFs(
                path,
                rootFs?.mntMap[path].getName() !== "FileSystemAccess"
              ),
            label: "Disconnect",
          });
        }

        if (EDITABLE_IMAGE_FILE_EXTENSIONS.has(urlExtension)) {
          menuItems.unshift({
            action: () => {
              open("Paint", { url });
              if (url) updateRecentFiles(url, "Paint");
            },
            label: "Edit",
          });
        }

        if (CURSOR_FILE_EXTENSIONS.has(urlExtension)) {
          menuItems.unshift({
            action: () => setCursor(url),
            label: "Set as mouse pointer",
          });
        }

        if (
          (aiEnabled || (hasWindowAI && "summarizer" in window.ai)) &&
          SUMMARIZABLE_FILE_EXTENSIONS.has(urlExtension)
        ) {
          const aiCommand = (command: string): void => {
            window.initialAiPrompt = `${command}: ${url}`;

            const newTopicButton = document.querySelector<HTMLButtonElement>(
              "main > section > footer > button.new-topic"
            );

            if (newTopicButton) {
              newTopicButton?.click();
            } else {
              getNavButtonByTitle(AI_TITLE)?.click();
            }
          };

          menuItems.unshift(MENU_SEPERATOR, {
            action: () => aiCommand("Summarize"),
            label: "Summarize Text (AI)",
          });
        }

        const hasBackgroundVideoExtension =
          VIDEO_FILE_EXTENSIONS.has(urlExtension);

        if (
          hasBackgroundVideoExtension ||
          (IMAGE_FILE_EXTENSIONS.has(urlExtension) &&
            !CURSOR_FILE_EXTENSIONS.has(urlExtension) &&
            urlExtension !== ".svg")
        ) {
          menuItems.unshift({
            label: "Set as background",
            ...(hasBackgroundVideoExtension
              ? {
                  action: () => setWallpaper(url),
                }
              : {
                  menu: [
                    {
                      action: () => setWallpaper(url, "fill"),
                      label: "Fill",
                    },
                    {
                      action: () => setWallpaper(url, "fit"),
                      label: "Fit",
                    },
                    {
                      action: () => setWallpaper(url, "stretch"),
                      label: "Stretch",
                    },
                    {
                      action: () => setWallpaper(url, "tile"),
                      label: "Tile",
                    },
                    {
                      action: () => setWallpaper(url, "center"),
                      label: "Center",
                    },
                  ],
                }),
          });
        }

        if (openWithFiltered.length > 0) {
          menuItems.unshift({
            label: "Open with",
            menu: [
              ...openWithFiltered.map((id): MenuItem => {
                const { icon, title: label } = processDirectory[id] || {};
                const action = (): void => {
                  openFile(id, icon);
                };

                return { action, icon, label };
              }),
              MENU_SEPERATOR,
              {
                action: () => open("OpenWith", { url }),
                label: "Choose another app",
              },
            ],
            primary: !pid,
          });
        }

        if (pid) {
          const { icon: pidIcon } = processDirectory[pid] || {};

          if (
            isShortcut &&
            url &&
            url !== "/" &&
            !url.startsWith("http:") &&
            !url.startsWith("https:") &&
            !url.startsWith("nostr:")
          ) {
            const isFolder = urlExtension === "" || urlExtension === ".zip";

            menuItems.unshift({
              action: () => open("FileExplorer", { url: dirname(url) }, ""),
              label: `Open ${isFolder ? "folder" : "file"} location`,
            });
          }

          if (
            fileManagerId &&
            pid === "FileExplorer" &&
            !MOUNTABLE_EXTENSIONS.has(urlExtension)
          ) {
            menuItems.unshift({
              action: () => {
                openFile(pid, pidIcon);
              },
              label: "Open in new window",
            });
          }

          menuItems.unshift({
            action: () => {
              if (
                pid === "FileExplorer" &&
                fileManagerId &&
                !MOUNTABLE_EXTENSIONS.has(urlExtension)
              ) {
                changeUrl(fileManagerId, url);
              } else {
                openFile(pid, pidIcon);
              }
            },
            icon: pidIcon,
            label: VIDEO_FILE_EXTENSIONS.has(urlExtension) ? "Play" : "Open",
            primary: true,
          });
        }

        return menuItems[0] === MENU_SEPERATOR ? menuItems.slice(1) : menuItems;
      }),
    [
      aiEnabled,
      archiveFiles,
      baseName,
      changeUrl,
      close,
      contextMenu,
      copyEntries,
      createPath,
      deleteLocalPath,
      downloadFiles,
      extractFiles,
      fileManagerId,
      focusedEntries,
      hasWindowAI,
      isFocusedEntry,
      lstat,
      mapFs,
      minimize,
      moveEntries,
      newShortcut,
      open,
      openFile,
      openTransferDialog,
      path,
      pid,
      processesRef,
      readFile,
      readOnly,
      rootFs?.mntMap,
      rootFs?.mountList,
      setCursor,
      setForegroundId,
      setIconPositions,
      setRenaming,
      setWallpaper,
      stats,
      unMapFs,
      updateFolder,
      updateRecentFiles,
      url,
    ]
  );

  return {
    onContextMenuCapture: (event?: React.MouseEvent | React.TouchEvent) => {
      if (!isFocusedEntry) {
        blurEntry();
        focusEntry(baseName);
      }
      onContextMenuCapture(event);
    },
    ...contextMenuHandlers,
  };
};

export default useFileContextMenu;
